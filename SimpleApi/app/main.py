from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel

app = FastAPI()


@app.get("/ping")
def ping():
    return JSONResponse(content={"status": "ok"})


class AddRequest(BaseModel):
    a: int
    b: int

@app.post("/add")
def add(data: AddRequest):
    return JSONResponse(content={"a": data.a, "b": data.b, "result": data.a + data.b})