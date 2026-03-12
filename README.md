# Alppikello ⏱️⛷️
**"Legacy of Speed"**

Alppikello on moderni, täysin selainpohjainen ja laitteistoriippumaton älykäs ajanottojärjestelmä, joka on suunniteltu erityisesti alppihiihtoon ja vastaaviin lajeihin. Se muuttaa useat tavalliset älypuhelimet ja tabletit yhdeksi synkronoiduksi, erittäin tarkaksi ajanottoverkostoksi. 

Perinteiset ja kalliit valokennojärjestelmät on korvattu laitteiden omiin kameroihin pohjautuvalla konenäöllä (Computer Vision) sekä pilvipohjaisella reaaliaikaisella synkronoinnilla.

---

## 🎯 Pääidea ja Toimintalogiikka

Ohjelma perustuu **"Harjoituksiin" (Sessions)**, joihin useat laitteet liittyvät eri rooleissa. Yksi laite voi toimia maalikamerana, toinen lähettäjän näytönä ja kolmas valmentajan käsivarressa reaaliaikaisena tulostauluna.

Koska sovellus toimii selainpohjaisesti (PWA), sitä ei tarvitse asentaa sovelluskaupoista. Kaikki tiedonsiirto laitteiden välillä tapahtuu reaaliajassa WebSockets-yhteydellä (Socket.io). 

### Keskeisimmät oivallukset
1. **Ei erillistä laitteistoa**: Kuka tahansa voi luoda ajanottojärjestelmän taskussaan olevilla puhelimilla.
2. **Kameraperustainen "valokenno" (CV)**: Laitteen kamera tunnistaa, kun urheilija alittaa lähtöportin tai ylittää maaliviivan muuttuvasta pikselimassasta, ja pysäyttää kellon tarkasti.
3. **Automaattinen videoparitukset**: Erillinen "Video"-roolissa oleva laite kuvaa suoritukset, ja pilvipalvelu (AWS S3) yhdistää automaattisesti oikean laskuajan ja videon yhdeksi jaettavaksi "Tuloskortiksi".
4. **Viiveen kumoaminen (Clock Sync)**: Sovellus mittaa jatkuvasti laitteiden välistä verkkoniveä (RTT / Offset) ja korjaa ajan digitaalisesti millisekuntien tarkkuudella.

---

## 👥 Roolit

Kun liityt harjoitukseen, valitset laitteesi tarvitseman roolin:

*   **Valmentaja (Coach)**: Luo harjoituksen, näkee kaikki reaaliaikaiset ajat, videoleikkeet sekä väliajat. Voi hallita urheilijoiden jonoa ja lopettaa tai arkistoida harjoituksen pysyvästi.
*   **Lähettäjä (Start Manager)**: Seisoo lähtöpaikalla, kerää urheilijat jonoon ja antaa lähtöluvan. Voi lisätä urheilijoita suoraan viivalta.
*   **Starttikello**: Laite, joka on kiinnitetty lähtöportille. Havaitsee laskijan liikkeellelähdön ja käynnistää kellon kaikille.
*   **Maalikello**: Laite, joka sijaitsee maalilinjalla. Käyttää laitteen kameraa havaitsemaan maaliintulon ja pysäyttää kellon.
*   **Väliaika**: Välipiste rinteessä, joka mittaa sektorikohtaisia aikoja konenäön avulla.
*   **Video**: Puhelin laakson pohjalla / rinteessä, joka kuvaa koko laskun ja lähettää sen AWS S3 -pilveen muiden laitteiden katsottavaksi.
*   **Urheilija / Katsomo**: Lukutila pelkkien tulosten ja videoiden reaaliaikaiseen katseluun.

---

## 🚀 Keskeiset Ominaisuudet

*   **Konenäkö-ajanotto (Computer Vision)**: Laitteiden selaimessa suoritettava algoritmi (HTML5 Canvas), joka havaitsee liikkeen asetetulla kohdealueella ja toimii kellon katkaisijana.
*   **Älykäs etäisyysmittari (Rangefinder)**: Valmentajan työkalu rataan tutustumiseen. Analysoi kännykän kamerakuvan keskiosan värejä ja tunnistaa automaattisesti ratalipun (punainen tai sininen) laskien etäisyyden kepille suoraan näytölle hyödyntäen polttovälimatematiikkaa.
*   **Tuloskorttien ja arkistojen jakaminen (Deep Linking)**: Yksittäisen suorituksen tai kokonaisen päivän harjoittelutulokset (videoidoineen) voi jakaa yhdellä WhatsApp-linkillä. Sovellus osaa poimia linkistä oikean arkiston ja näyttää sen suoraan lukijalle.
*   **Pysyvä pilviarkisto**: Tulokset tallentuvat JSON-muodossa paikallisesti nopeaa käyttöä varten, mutta siirtyvät aina lopuksi AWS S3 -pilveen turvaan.
*   **QR-Koodi liittyminen**: Uudet puhelimet saa liitettyä sekunnissa skannaamalla QR-koodin "Master"-laitteesta (Valmentajalta).

---

## 🛠️ Teknologia

*   **Frontend**: Puhdas selaintekniikka (HTML, CSS, Vanilla JavaScript, WebRTC/Kamera-API, PWA-kääre mobiililaitteille).
*   **Backend**: Node.js & Express.
*   **Reaaliaikainen viestintä**: Socket.IO (kattaa synkronoinnin, kellon aloitukset/lopetukset, videoiden tilat).
*   **Pilvitallennus**: AWS S3 (Videoiden ja arkistojen pysyväiskirjasto). UseS3-fallback-logiikalla, eli toimii tarvittaessa myös ilman pilveä pelkällä lokaalilla muistilla.

---

> *"Alppikello tuo MM-tason ajanoton kenen tahansa taskuun, ilman kymmenien tuhansien eurojen laiteinvestointeja."*
