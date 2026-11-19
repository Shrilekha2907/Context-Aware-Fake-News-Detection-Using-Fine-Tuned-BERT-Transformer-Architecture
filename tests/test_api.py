import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.model import DATA_DIR


@pytest.fixture(scope='module')
def client(tmp_path_factory):
    with pytest.MonkeyPatch.context() as patch:
        patch.setenv('FAKE_NEWS_DB', str(tmp_path_factory.mktemp('db') / 'test.db'))
        with TestClient(app) as test_client:
            yield test_client


@pytest.fixture(autouse=True)
def empty_history(client):
    client.delete('/api/history')


def test_home_page_and_health(client):
    assert 'IFND Headline Checker' in client.get('/').text
    assert client.get('/api/health').json() == {'status': 'ok'}


def test_predict_fake_and_real_with_word_effects(client):
    headline = 'Viral video claims the government will give free phones to all students'
    fake = client.post('/api/predict', json={'headline': headline}).json()
    real = client.post('/api/predict', json={'headline': 'Supreme Court seeks response from Centre on new highway plea'}).json()
    assert fake['label'] == 'fake' and fake['has_giveaway_words']
    assert real['label'] == 'real' and not real['has_giveaway_words']
    assert ' '.join(w['word'] for w in fake['words']) == headline
    assert all(isinstance(w['effect'], float) for w in fake['words'])


def test_score_saves_nothing(client):
    result = client.post('/api/score', json={'headline': 'Viral video claims free phones'}).json()
    assert result['label'] == 'fake' and 'words' not in result
    assert client.get('/api/history').json()['checks'] == []


def test_unreadable_text_gives_no_result(client):
    result = client.post('/api/predict', json={'headline': 'क्या है'}).json()
    assert result['label'] is None and result['prob_fake'] is None and result['words'] == []
    assert client.get('/api/history').json()['checks'] == []


@pytest.mark.parametrize('headline', ['', '    ', 'x' * 2001])
def test_invalid_headlines_are_rejected(client, headline):
    assert client.post('/api/predict', json={'headline': headline}).status_code == 422


def test_long_headline_is_flagged_and_partly_explained(client):
    result = client.post('/api/predict', json={'headline': 'court ' * 100}).json()
    assert result['truncated'] and not result['explained_all_words']
    assert result['words'][-1]['effect'] is None


def test_batch(client):
    headlines = ['Viral video claims free phones', 'Supreme Court seeks response from Centre', 'क्या']
    body = client.post('/api/predict/batch', json={'headlines': headlines}).json()
    assert body['summary'] == {'total': 3, 'fake': 1, 'real': 1, 'no_result': 1}
    assert [r['headline'] for r in body['results']] == headlines
    assert client.post('/api/predict/batch', json={'headlines': []}).status_code == 422
    assert client.post('/api/predict/batch', json={'headlines': ['a'] * 201}).status_code == 422


def test_batch_matches_single_score(client):
    headline = 'Supreme Court seeks response from Centre'
    single = client.post('/api/score', json={'headline': headline}).json()
    batch = client.post('/api/predict/batch', json={'headlines': [headline]}).json()['results'][0]
    assert batch['prob_fake'] == pytest.approx(single['prob_fake'], abs=1e-5)


def test_history_saves_newest_first_and_clears(client):
    client.post('/api/predict', json={'headline': 'First court headline'})
    client.post('/api/predict', json={'headline': 'Second court headline'})
    checks = client.get('/api/history').json()['checks']
    assert [c['headline'] for c in checks] == ['Second court headline', 'First court headline']
    client.delete('/api/history')
    assert client.get('/api/history').json()['checks'] == []


def test_sample(client):
    assert client.get('/api/samples/random').json()['label'] in {'fake', 'real'}


def test_test_scores_reproduce_saved_results(client):
    report = client.get('/api/model').json()
    scores = pd.DataFrame(report['test_scores'])
    saved = pd.read_csv(DATA_DIR / 'student_4_test_predictions.csv')
    assert ((scores['prob_fake'] >= 0.5).astype(int) == saved['prediction']).all()
    assert (scores['label'] == saved['label']).all()
