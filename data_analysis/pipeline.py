import pandas as pd

from sqlalchemy import create_engine
engine = create_engine(
    "postgresql+psycopg2://postgres:1234@localhost:5432/commdis"
)

columns = pd.read_sql("""
SELECT
    column_name,
    data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'Vente'
ORDER BY ordinal_position
""", engine)

print("\n========== COLONNES DE VENTE ==========")
print(columns.to_string(index=False))