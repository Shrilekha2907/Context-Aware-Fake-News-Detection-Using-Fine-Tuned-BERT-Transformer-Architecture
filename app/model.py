"""Loads Student 4's fine-tuned BERT and runs predictions on headlines."""
import json
import re
import threading
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

BASE = Path(__file__).resolve().parent.parent
MODEL_DIR = BASE / 'models' / 'bert'
DATA_DIR = BASE / 'data'
MAX_LEN = 64
MAX_EXPLAINED_WORDS = 40

APOSTROPHES = ['\x92', '\xd5', '\x89\xdb\xaa', '\xe2\x80\x99', '\xef\xbf\xbd']
GIVEAWAY = re.compile(
    r'\b(?:fact check|factcheck|fake|false|falsely|viral|claim|claims|claimed|misleading|hoax|'
    r'rumou?r|debunk|no this|not a|shared as|shared with|morphed|doctored|old video|old photo|'
    r'video|photo|image|picture)\b')


def repair_text(text):
    """Same text repair as the training notebook."""
    for broken in APOSTROPHES:
        text = text.replace(broken, "'")
    text = re.sub(r'[^\x00-\x7f]+', ' ', text)
    return re.sub(r'\s+', ' ', text).strip()


def to_logit(prob):
    prob = np.clip(prob, 1e-7, 1 - 1e-7)
    return np.log(prob / (1 - prob))


class ModelFilesMissing(RuntimeError):
    pass


class HeadlineClassifier:
    def __init__(self):
        if not (MODEL_DIR / 'model.safetensors').exists():
            raise ModelFilesMissing(
                f'The BERT model is missing. Copy the files from models/bert in '
                f'bert_model_and_data.zip into {MODEL_DIR}')
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        self.tokenizer = AutoTokenizer.from_pretrained(MODEL_DIR)
        self.model = AutoModelForSequenceClassification.from_pretrained(MODEL_DIR).to(self.device).eval()
        self.lock = threading.Lock()
        self.samples = pd.read_csv(DATA_DIR / 'test_headlines.csv')
        self.report = self._build_report()

    def _probabilities(self, texts, batch_size=32):
        """Longest-first batches keep padding, and so CPU time, low."""
        order = np.argsort([-len(t) for t in texts])
        probs = np.zeros(len(texts))
        with self.lock, torch.no_grad():
            for start in range(0, len(texts), batch_size):
                chosen = order[start:start + batch_size]
                encoded = self.tokenizer([texts[i] for i in chosen], truncation=True, padding=True,
                                         max_length=MAX_LEN, return_tensors='pt').to(self.device)
                logits = self.model(**encoded).logits.float()
                probs[chosen] = torch.softmax(logits, dim=1)[:, 1].cpu().numpy()
        return probs

    def _base_result(self, headline):
        repaired = repair_text(headline)
        key = re.sub(r'[^a-z0-9]+', ' ', repaired.lower()).strip()
        token_count = len(self.tokenizer.tokenize(repaired)) + 2
        return {'headline': headline, 'label': None, 'prob_fake': None,
                'has_giveaway_words': bool(GIVEAWAY.search(key)),
                'truncated': token_count > MAX_LEN}, repaired, bool(key)

    def score(self, headline):
        """Fast score without word effects, used for live typing and word toggles."""
        result, repaired, readable = self._base_result(headline)
        if readable:
            prob_fake = float(self._probabilities([repaired])[0])
            result.update(label='fake' if prob_fake >= 0.5 else 'real', prob_fake=round(prob_fake, 6))
        return result

    def score_many(self, headlines):
        results = []
        readable = []
        for headline in headlines:
            result, repaired, can_read = self._base_result(headline)
            results.append(result)
            if can_read:
                readable.append((result, repaired))
        if readable:
            probs = self._probabilities([text for _, text in readable])
            for (result, _), prob_fake in zip(readable, probs):
                result.update(label='fake' if prob_fake >= 0.5 else 'real',
                              prob_fake=round(float(prob_fake), 6))
        return results

    def explain(self, headline):
        """Score a headline, then remove each word in turn and measure the change."""
        result = self.score(headline)
        result['words'] = []
        result['explained_all_words'] = True
        if not result['label']:
            return result
        words = repair_text(headline).split()
        explained = words[:MAX_EXPLAINED_WORDS]
        result['explained_all_words'] = len(words) == len(explained)
        variants = [' '.join(words[:i] + words[i + 1:]) for i in range(len(explained))]
        changed = self._probabilities(variants)
        base = to_logit(result['prob_fake'])
        for i, word in enumerate(words):
            effect = float(base - to_logit(changed[i])) if i < len(explained) else None
            result['words'].append({'word': word,
                                    'effect': None if effect is None else round(effect, 4)})
        return result

    def random_sample(self):
        row = self.samples.sample(1).iloc[0]
        return {'headline': row['headline'], 'label': 'fake' if row['label'] == 1 else 'real'}

    def _build_report(self):
        saved = json.loads((DATA_DIR / 'student_4_metrics.json').read_text(encoding='utf-8'))
        scores = pd.read_csv(DATA_DIR / 'test_scores.csv')
        return {
            'algorithm': saved['algorithm'],
            'test_metrics': saved['test_metrics'],
            'robustness': saved['robustness'],
            'details': {k: v for k, v in saved['details'].items() if k != 'training_log'},
            'training_log': saved['details']['training_log'],
            'parameters': sum(p.numel() for p in self.model.parameters()),
            'device': self.device.type,
            'test_scores': {
                'label': scores['label'].tolist(),
                'prob_fake': scores['prob_fake'].tolist(),
                'is_augmented': scores['is_augmented'].tolist(),
                'has_giveaway': scores['has_giveaway'].tolist(),
            },
        }
