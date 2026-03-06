# Alppikello Projektin Tila - 2026-03-04

## Toteutettu tänään:
- **Video buffering:** 20s RAM buffer MediaRecorderilla.
- **Smart triggers:** CV-laukaisu vain jos laskija on radalla.
- **Predictive ETA:** Laskijan saapumisaika kameralle (T-plus) perustuen GPS-etäisyyteen.
- **Central Archive:** Automaattinen upload palvelimelle ja katselulinkit tuloriville.
- **Hybrid Tracking:** Matemaattinen ennuste + vapaaehtoinen GPS-varmennus.

## Versiohistoria lyhyesti:
- v1.9.0: Smart-Sync (Runner detection)
- v1.9.3: Stable-Buffer (Fix 0s videos)
- v1.9.5: Predict-Fix (ETA math)
- v2.0.0: ALV-Archive (Upload & Centralized view)

## Jatko-osan tavoitteet:
1. Pysyvä tallennus (S3).
2. Usean videon synkronoitu toisto (Split screen).
3. Akun keston optimointi videokäytössä.
