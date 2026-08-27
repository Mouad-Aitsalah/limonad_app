import pandas as pd
from sqlalchemy import create_engine, text

DATABASE_URL = "postgresql://postgres:1234@localhost:5432/commdis"
engine = create_engine(DATABASE_URL)

with engine.connect() as connection:
    result = connection.execute(text("SELECT 1"))
    print("Connexion PostgreSQL réussie :", result.scalar())
    query = """
SELECT *
FROM "Sale"
"""
sales = pd.read_sql(query, engine)
print("\nLes 5 premières ventes :")
print(sales.head())

print("\nLes colonnes disponibles :")
print(sales.columns.tolist())
# Convertir la date
sales["createdAt"] = pd.to_datetime(sales["createdAt"])

# Convertir totalTTC en nombre si nécessaire
sales["totalTTC"] = pd.to_numeric(sales["totalTTC"], errors="coerce")

# 1. Nombre total de ventes
nombre_ventes = len(sales)

# 2. Chiffre d'affaires total
chiffre_affaires = sales["totalTTC"].sum()

# 3. Panier moyen
panier_moyen = sales["totalTTC"].mean()

print("\n===== ANALYSE DES VENTES =====")

print("Nombre de ventes :", nombre_ventes)
print("Chiffre d'affaires :", chiffre_affaires, "DH")
print("Panier moyen :", panier_moyen, "DH")
vente_max = sales["totalTTC"].max()
vente_min = sales["totalTTC"].min()

print("Plus grande vente :", vente_max, "DH")
print("Plus petite vente :", vente_min, "DH")
sales["paidAmount"] = pd.to_numeric(
    sales["paidAmount"],
    errors="coerce"
)

sales["creditAmount"] = pd.to_numeric(
    sales["creditAmount"],
    errors="coerce"
)

total_encaisse = sales["paidAmount"].sum()
total_credit = sales["creditAmount"].sum()
pourcentage_credit = (
    total_credit / chiffre_affaires
) * 100

print(
    "Pourcentage du CA à crédit :",
    round(pourcentage_credit, 2),
    "%"
)
ca_par_client = sales.groupby(
    "customerId"
)["totalTTC"].sum().sort_values(
    ascending=False
)

print(ca_par_client.head(3))