import ast

with open("entrega-pc/backend-ia_tickets.py", encoding="utf-8") as f:
    src = f.read()

ast.parse(src)
print(f"Sintaxis OK — {len(src.splitlines())} líneas")
