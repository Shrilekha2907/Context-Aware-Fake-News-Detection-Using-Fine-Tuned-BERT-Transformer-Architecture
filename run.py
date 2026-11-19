"""Start the web app: python run.py"""
import sys
import threading
import webbrowser
from pathlib import Path

import uvicorn

URL = 'http://127.0.0.1:8000'
MODEL_FILE = Path(__file__).resolve().parent / 'models' / 'bert' / 'model.safetensors'

if __name__ == '__main__':
    if not MODEL_FILE.exists():
        sys.exit('The BERT model is missing.\n'
                 'Copy config.json, model.safetensors, tokenizer.json and tokenizer_config.json\n'
                 'from models/bert in bert_model_and_data.zip into:\n'
                 f'{MODEL_FILE.parent}')
    print(f'Loading BERT. The app will open at {URL} (press Ctrl+C to stop)')
    threading.Timer(6, webbrowser.open, args=(URL,)).start()
    uvicorn.run('app.main:app', host='127.0.0.1', port=8000)
