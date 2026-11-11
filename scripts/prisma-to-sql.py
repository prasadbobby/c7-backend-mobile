"""Generate PostgreSQL DDL from FitForge's schema.prisma using Prisma's default
naming conventions. Used ONLY to build the local test database so the backend's
tests run against the exact same table/column/enum shapes as production."""
import re, sys
src = open(sys.argv[1]).read()
src = re.sub(r'//[^\n]*', '', src)
enums, models = {}, {}
for m in re.finditer(r'enum\s+(\w+)\s*\{([^}]*)\}', src):
    vals = []
    for line in m.group(2).strip().splitlines():
        line = line.strip()
        if not line: continue
        mm = re.match(r'(\w+)(?:\s+@map\("([^"]+)"\))?', line)
        vals.append(mm.group(2) or mm.group(1))
    enums[m.group(1)] = vals
for m in re.finditer(r'model\s+(\w+)\s*\{([^}]*)\}', src):
    models[m.group(1)] = m.group(2)
SCALAR = {'String': 'TEXT', 'Int': 'INTEGER', 'Float': 'DOUBLE PRECISION', 'Boolean': 'BOOLEAN', 'DateTime': 'TIMESTAMP(3)', 'Json': 'JSONB'}
out = []
for e, vals in enums.items():
    out.append(f'CREATE TYPE "{e}" AS ENUM ({", ".join(chr(39)+v+chr(39) for v in vals)});')
fks = []
for name, body in models.items():
    cols, pk, uniques, idx = [], None, [], []
    for line in body.strip().splitlines():
        line = line.strip()
        if not line: continue
        if line.startswith('@@'):
            g = re.match(r'@@(id|unique|index)\(\[([^\]]+)\]', line)
            if g:
                fields = [f.strip() for f in g.group(2).split(',')]
                {'id': lambda f: None, 'unique': uniques.append, 'index': idx.append}[g.group(1)](fields)
                if g.group(1) == 'id': pk = fields
            continue
        mm = re.match(r'(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)', line)
        if not mm: continue
        fname, ftype, arr, opt, attrs = mm.groups()
        if ftype in models:
            r = re.search(r'fields:\s*\[([^\]]+)\],\s*references:\s*\[([^\]]+)\](?:,\s*onDelete:\s*(\w+))?', attrs)
            if r:
                od = {'Cascade': 'CASCADE', 'SetNull': 'SET NULL', 'Restrict': 'RESTRICT', None: 'SET NULL' if opt else 'RESTRICT'}[r.group(3)]
                fks.append(f'ALTER TABLE "{name}" ADD FOREIGN KEY ("{r.group(1).strip()}") REFERENCES "{ftype}"("{r.group(2).strip()}") ON DELETE {od} ON UPDATE CASCADE;')
            continue
        if ftype in SCALAR: sql = SCALAR[ftype]
        elif ftype in enums: sql = f'"{ftype}"'
        else: continue
        if arr: sql += '[]'
        col = f'"{fname}" {sql}'
        if not opt and not arr: col += ' NOT NULL'
        if arr: col += ' NOT NULL DEFAULT ARRAY[]::' + sql
        d = re.search(r'@default\(((?:[^()]|\([^()]*\))*)\)', attrs)
        if d and not arr:
            v = d.group(1)
            if v == 'now()': col += ' DEFAULT CURRENT_TIMESTAMP'
            elif v in ('uuid()', 'cuid()'): pass
            elif v in ('true', 'false') or re.match(r'^-?\d+(\.\d+)?$', v): col += f' DEFAULT {v}'
            elif v.startswith('"'): col += " DEFAULT '" + v.strip('"').replace("'", "''") + "'" + ('::jsonb' if ftype == 'Json' else '')
            else: col += f" DEFAULT '{v}'"
        if '@id' in attrs.split('@default')[0] or re.search(r'@id\b', attrs): pk = [fname]
        if re.search(r'@unique\b', attrs): uniques.append([fname])
        cols.append('  ' + col)
    if pk: cols.append(f'  CONSTRAINT "{name}_pkey" PRIMARY KEY ({", ".join(chr(34)+p+chr(34) for p in pk)})')
    out.append(f'CREATE TABLE "{name}" (\n' + ',\n'.join(cols) + '\n);')
    for u in uniques:
        out.append(f'CREATE UNIQUE INDEX "{name}_{"_".join(u)}_key" ON "{name}"({", ".join(chr(34)+c+chr(34) for c in u)});')
    for i in idx:
        out.append(f'CREATE INDEX "{name}_{"_".join(i)}_idx" ON "{name}"({", ".join(chr(34)+c+chr(34) for c in i)});')
print('\n'.join(out + fks))
