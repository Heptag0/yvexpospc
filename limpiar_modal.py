from pathlib import Path

p = Path(r"src/componentes/ModalEscanearTicket.tsx")
lines = p.read_text(encoding="utf-8").splitlines()

cleaned = []
i = 0
while i < len(lines):
    l = lines[i]
    if (l.strip() == '/** "2026-07-14" -> "14 jul 2026" (si falla, devuelve el texto tal cual). */' and
        i + 1 < len(lines) and
        lines[i+1].strip().startswith("function fmtFechaTicket(f: string | null): string | null {")):
        candidate_jsdoc = l
        candidate_func = lines[i+1]
        i += 2
        if i < len(lines) and lines[i].strip() == "};":
            i += 1
            continue
        else:
            cleaned.append(candidate_jsdoc)
            cleaned.append(candidate_func)
            continue
    cleaned.append(l)
    i += 1

p.write_text("\n".join(cleaned), encoding="utf-8")
