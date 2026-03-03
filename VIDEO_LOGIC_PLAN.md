# Alppikello: Älykäs Video- ja Sijaintilogiikka (v1.7.0)

Tämä dokumentti määrittelee, miten Alppikello yhdistää GPS-sijainnin, Computer Vision (CV) -liikkeentunnistuksen ja ajanoton automaattiseksi monikamerajärjestelmäksi.

## 1. Perusoletus: Rata ja Aika-avaruus
Järjestelmä ei näe maailmaa pelkkinä koordinaatteina, vaan **yhtenäisenä ratana**, joka alkaa Starttikellosta ja päättyy Maaliin.
*   **Akseli L (Location):** Radan pituus metreinä (0m = Startti, Xm = Maali).
*   **Akseli T (Time):** Aika sekunteina lähdöstä.
*   **GPS-projekti:** Jokainen laite lähettää GPS-koordinaattinsa. Palvelin laskee niiden "L-arvon" (kuinka kaukana ne ovat startista radan linjaa pitkin).

## 2. Kameroiden automaattinen konfigurointi
Kameran (VIDEO-rooli) ei tarvitse tietää suuntaansa tai tarkkaa paikkaansa manuaalisesti:
1.  **GPS-sijainti:** Kamera ilmoittaa olevansa esim. kohdassa L = 450m.
2.  **Ennustettu saapumisaika (ETA):** Jos laskijan keskinopeus on 15 m/s, palvelin laskee, että laskija saavuttaa tämän kameran ajassa T = 30s (+/- 5s).
3.  **Oppiva kalibrointi:** Järjestelmä hienosäätää kameran T-arvoa jokaisen onnistuneen suorituksen jälkeen (jos liike havaittiin todellisuudessa ajassa 29.5s, T-arvo päivittyy).

## 3. Liikkeentunnistus ja "Odotusvalmius" (Sivullisten esto)
Kamera ei reagoi kaikkeen liikkeeseen (esim. turistit), vaan käyttää **"Aktiivista Ikkunaa"**:
*   Kamera on "Passiivinen", kun radalla ei ole ketään. CV-tunnistus on päällä, mutta se ei lähetä triggereitä.
*   Kamera muuttuu "Aktiiviseksi" vain silloin, kun joku laskija on sen **odotus-ikkunassa** (esim. ETA +/- 4 sekuntia).
*   **Tulos:** Jos turisti suhahtaa ohi väärään aikaan, kamera huomaa liikkeen, mutta hylkää sen "meluna".

## 4. Älykäs Leikkauslogiikka (Tyhjien kuvien esto)
Leikkaus ei perustu pelkkään etäisyyteen, vaan **"Kameran huutoon"**:
1.  **Haku:** Palvelin etsii kaikki kamerat, jotka ovat lähellä laskijan nykyistä ennustettua sijaintia.
2.  **Varmistus:** Se valitsee niistä kameran, joka parhaillaan lähettää `motion_detected: true` -viestiä.
3.  **Vaihto:** Kun Kamera 1 lopettaa liikkeen havaitsemisen (laskija poistui kuvasta), järjestelmä vaihtaa välittömästi seuraavaan kameraan (Kamera 2), joka jo "huutaa" näkevänsä liikettä.
4.  **Fallback:** Jos mikään kamera ei näe liikettä, käytetään GPS:n mukaan lähintä kameraa (varmuuden vuoksi).

## 5. Usean laskijan hallinta (FIFO-malli)
Miten toimitaan, jos kamerassa näkyy kaksi laskijaa?
*   **ID-kohdistus:** Jokaisella liikkeellä on aikaleima. Palvelin vertaa tätä aikaleimaa kaikkien radalla olevien laskijoiden ETA-arvoihin.
*   **Intervalli-suositus:** Järjestelmä suosittelee vähintään **25 sekunnin** lähetyksiä. 
*   **Monitorointi:** Starttikellon "liikennevalo" pysyy keltaisena, kunnes edellinen laskija on ohittanut kriittisen GPS-pisteen tai tullut maaliin.

## 6. Tekninen tallennusketju
1.  **Laitteen puskuri:** Puhelin tallentaa jatkuvaa videota RAM-muistiin (puskurointi).
2.  **Leikkaus-triggeri:** Kun liike alkaa ja loppuu "odotus-ikkunassa", laite leikkaa pätkän (sisältäen 2s etu- ja jälkikäteen).
3.  **Metadata:** Tiedostoon liitetään: `SessionID_RunnerID_RunCount_CameraName.mp4`.
4.  **Upload:** Video ladataan palvelimelle taustalla, kun kaistaa on vapaana.

## 7. Aikajanalla synkronointi ja yhtenäinen suoritus
Tämä osio määrittelee, miten videosta saadaan yhtenäinen suoritus laskijan näkökulmasta:

1.  **Nollahetki (T=0):** Laskun nollahetki on Starttikellon laukaisun palvelinkellonaika.
2.  **Relatiivinen sijainti:** Jokainen videoklippi saa metadataansa kaksi arvoa: `start_offset` ja `end_offset` (millisekunteja startista).
    *   Esim: Videoklippi kuvattu palvelinajalla 12:05:10, startti oli 12:05:00 -> `start_offset = 10 000ms`.
3.  **Toisto (Playback):** Tuloksia katsellessa sovellus käyttää yhtä Master-kelloa. Kun master-kello saavuttaa tietyn offsetin, vastaava videopätkä näytetään.
4.  **Synkronoitu kello:** Videon päällä juokseva ajanotto-kello on suoraan sidottu master-kelloon, jolloin kuva ja aika eivät voi erkaantua toisistaan (vaikka video pätkisi, kello näyttää todellisen suoritusajan).
5.  **Multi-Angle Crossfade:** Jos kaksi kameraa näkee laskijan samaan aikaan, soitin suosii "Aktiivisempaa" tai GPS-sijainniltaan lähempää kameraa, ja tekee vaihdon saumattomasti relatiivisen aikajanan perusteella.

## 8. Lineaarinen aikajana ja vertailukelpoisuus
Jotta videoita voidaan tulevaisuudessa verrata keskenään (Ghost-analyysi), järjestelmä toimii seuraavasti:

1.  **Lineaarinen Kesto:** Videon kokonaiskesto on AINA täsmälleen yhtä suuri kuin laskun todellinen suoritusaika (Maali - Startti).
2.  **Katvealueiden hallinta (Linear Continuity):** Jos laskija ei ole yhdenkään kameran näkyvissä tietyllä ajanhetkellä `t`:
    *   Soitin näyttää tyhjän ruudun sijasta dynaamisen **2D-ratakartan**.
    *   Laskijan sijainti radalla näytetään kartassa GPS- ja nopeusdatan perusteella laskettuna "pisteenä".
3.  **Täydellinen Synkronointi:** Kaikki suoritukset (Run 1, Run 2) alkavat ajanhetkestä `00:00.00`. Vertailutilassa molemmat videot (ja karttapisteet) kulkevat täsmälleen samassa tahdissa.
4.  **Siirtymät:** Kameroiden vaihdot tapahtuvat "lennosta" millisekunnin tarkkuudella relatiivisen aikajanan perusteella.
5.  **Analyysitila:** Käyttäjä voi pysäyttää "Master Clockin", jolloin kaikki kytketyt videot ja karttanäkymät pysähtyvät samaan relatiiviseen aikaan suorituksen alusta.
