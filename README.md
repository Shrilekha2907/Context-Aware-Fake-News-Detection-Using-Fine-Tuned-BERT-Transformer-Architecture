# IFND Headline Checker (Student 4: BERT)

A one-page web app for testing Student 4's fine-tuned BERT fake news model.

## Set it up
You need Python 3.10 or newer.

1. **Add the model.** It is about 440 MB, so it isn't in this zip. Copy `config.json`,
   `model.safetensors`, `tokenizer.json` and `tokenizer_config.json` from `models/bert` in
   `bert_model_and_data.zip` into `models/bert` in this folder.
2. **Install and run.** In this folder, run:

```
pip install -r requirements.txt
python run.py
```

The app opens at http://127.0.0.1:8000. Press Ctrl+C in the terminal to stop it. A GPU is used if
one is available; a CPU works too, with a short delay on each result.

## What's on the page
- **Check a headline:** live score while typing, a word map, and word toggles to see how the score changes.
- **You vs BERT:** guess whether test headlines are real or fake, then compare with the model.
- **Check many headlines:** paste up to 200, then filter, sort and download the results.
- **Explore the results:** move the decision threshold and switch test groups to see the scores update.
- **Recent checks:** reopen or delete saved checks.

## How the word effects work
The app removes each word in turn and measures how the score changes. These values are estimates of
the model's behaviour, and words can also interact with each other.

## Files
- `app/main.py`: FastAPI routes
- `app/model.py`: model loading, prediction and word effects
- `app/database.py`: SQLite check history, stored in `data/history.db`
- `data/test_scores.csv`: BERT's probability for each test headline, recalculated on a CPU from the
  saved model; its predictions are checked against the notebook's results
- `static/`: web interface
- `tests/`: API tests; run them with `python -m pytest`

Interactive API documentation is at http://127.0.0.1:8000/docs.

## Limits of the model
The model learned the wording of the IFND dataset. It does not check facts. Its results should not
be used to decide whether a claim is true.

IFND is for research use only. Cite: Sharma, D. K., & Garg, S. (2021). IFND: a benchmark dataset for
fake news detection. Complex & Intelligent Systems.
