# Simple FastAPI Hello World

This is a minimal FastAPI project with a single endpoint `/hello` that returns a JSON response `{ "message": "Hello World" }`.

## Setup

1. Install dependencies:
   ```sh
   pip install -r requirements.txt
   ```
2. Run the API:
   ```sh
   uvicorn app.main:app --reload
   ```
3. Visit [http://127.0.0.1:8000/hello](http://127.0.0.1:8000/hello)

## Project Structure

- `app/main.py` - FastAPI app with `/hello` endpoint
- `requirements.txt` - Python dependencies
