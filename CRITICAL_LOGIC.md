# 🛡️ ALPPIKELLO: KRIITTISEN LOGIIKAN MUISTILISTA

Tämä tiedosto on pyhä. Se sisältää projektin ydintoiminnot, joita **ei saa muuttaa tai poistaa** ilman eksplisiittistä ohjeistusta. AI-avustajan on luettava tämä ennen jokaista koodimuutosta.

## 🏁 PERUSTAVOITE
1. **Huipputarkka hajautettu ajanotto** (yhteinen kellonaika kaikkien laitteiden välillä).
2. **Automaattinen videointi**, joka on synkronoitu ajanottoon ja GPS-sijaintiin.

---

## 🏗️ ARKKITEHTUURIN KULMAKIVET
*   **Hajautettu rakenne:** Palvelin (backend) on keskiössä, mutta laitteet toimivat itsenäisinä sensoreina tai käyttöliittyminä.
*   **Synkronointi:** Kaikki aikaleimat perustuvat `getSyncedTime()` -funktioon, joka tasaa viiveet palvelimen ja laitteen välillä.
*   **Roolien vaihdettavuus:** Kaikki laitteet voivat vaihtaa roolia lennosta (esim. jos akku loppuu, toinen puhelin korvaa maalikellon).

---

## 👥 ROOLIT (People vs. Devices)

### Ihmiset (Mikä tahansa määrä)
*   **VALMENTAJA:** Hallinnoi harjoitusta, näkee kaikki ajat ja statuses. Oikeus lopettaa harjoitus.
*   **URHEILIJA:** Näkee omat aikansa ja jono-statuksen.
*   **KATSOMO:** Passiivinen näkymä ajanoton seuraamiseen (ei hallintaoikeuksia).

### Laitteet (Sensori- ja ohjausroolit)
*   **LÄHTÖPAIKKA:** (YKSI PER RATA) Lähettäjä valitsee seuraavan laskijan nimen. Voi lisätä uusia nimiä "lennossa".
*   **STARTTIKELLO:** (YKSI PER RATA) Käyttää **liikkeentunnistusta (CV)** ajanoton käynnistämiseen.
*   **MAALIKELLO:** (YKSI PER RATA) Käyttää **liikkeentunnistusta (CV)** ajanoton pysäyttämiseen.
*   **VÄLIAIKA:** (USEITA) Käyttää **liikkeentunnistusta (CV)** väliajan ottamiseen.
*   **VIDEOKAMERAT:** (USEITA) Puskuroivat videota ja tallentavat pätkät palvelimelle ajanoton triggauksesta.

---

## ⚠️ ÄLÄ KOSKAAN RIKO NÄITÄ (Regression Guard)

### 1. CV-Sensorit (Start, Väliaika, Maali, Video)
*   **Elementit:** `video`-tägi, `canvas`-maski ja `status-overlay` on säilyttävä HTML:ssä.
*   **Logiikka:** `initTriggerCV` -funktio ja sen aktivoivat painikkeet ovat kriittisiä.
*   **Automaatio:** Laitteen on toimittava sensorina ilman manuaalisia nappien painalluksia (pois lukien testaus tai "lennosta" lisäys).

### 2. Harjoituksen kulku & "Haamuesto"
*   **Jono (Queue):** Järjestelmän on aina tiedettävä kuka on radalla (`onCourse`).
*   **Validointi:** Laskijan aikaan ja GPS-sijaintiin perustuva suodatus estää virheelliset liipaisut.
*   **Server-Side Logic:** Päätös liipaisun hyväksymisestä tehdään palvelimella perustuen odotettuun aikaan ja sijaintiin.

### 3. Deplaus ja Yhteys
*   **Server URL:** `SERVER_URL` on asetettava oikein (Render tai localhost).
*   **Socket Events:** Älä poista `device_status_update` tai `timing_update` käsittelijöitä – ne pitävät UI:n ajantasaisena.

---

## 📝 JATKOKEHITYS
*   Kun lisäät uusia ominaisuuksia, varmista että ne eivät kasvata `index.html` -tiedostoa tavalla, joka rikkoo vanhan CSS-flexbox-rakenteen.
*   Käytä aina premium-lookia (vibrantit värit, lasiefektit, selkeät ikonit).

---
*Päivitetty: 2026-03-06*
