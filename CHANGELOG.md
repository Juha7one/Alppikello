# Alppikello Muutoshistoria

Tämä tiedosto sisältää kuvauksen kaikista Alppikello-projektin merkittävistä päivityksistä ja ominaisuusmuutoksista.

## v1.7.1 - "GIT-KÄYTTÖÖNOTTO" (2026-03-04)
*   **Automaattinen käyttönotto:** Lisätty `.cpanel.yml`-tiedosto tukemaan palvelimen Git-pohjaista deploymentia.
*   **Palvelinvalmius:** Lisätty `tmp/restart.txt` sovelluksen automaattista uudelleenkäynnistystä varten (Phusion Passenger / StackCP tuki).

## v1.7.0 - "GPS-VALMIUS" (2026-03-03)
*   **Automaattinen GPS-seuranta:** Kaikki laitteet lähettävät nyt sijaintitietonsa palvelimelle 5 sekunnin välein.
*   **Sijaintitiedon tallennus:** Palvelin tallentaa kunkin laitteen koordinaatit ja tarkkuuden osaksi laitteen statusta.
*   **Pohja älykkäälle videolle:** Tämä päivitys luo teknisen pohjan automaattiselle kameroiden valinnalle sijainnin perusteella.

## v1.6.1 - "ROOLINIMET" (2026-03-03)
*   **Laitteiden roolinimet:** Valmentajan näkymässä näkyy nyt selkeästi laitteen rooli ennen sen nimeä (esim. "MAALI: IPAD 1").
*   **Selkeytetty näyttö:** Parannettu laitelistauksen luettavuutta lisäämällä tekstiprefiksit.

## v1.6.0 - "MONITOIMIPANEELI" (2026-03-03)
*   **Laitteiden seurantapaneeli:** Valmentajalle uusi reaaliaikainen näkymä kaikkien kiinteiden laitteiden tilaan (Linjoilla / Ei yhteyttä).
*   **Reaaliaikainen yhteysstatus:** Paneeli näyttää laitteen heartbeat-signaalin perusteella, onko se aktiivinen (15 sekunnin timeout).
*   **Käyttöliittymäparannus:** Valmentajan näkymän alaosaan lisätty selkeä ruudukko kytketyistä laitteista.

## v1.5.0 - "LAITTEIDEN-VAIHTO" (2026-03-03)
*   **Henkilö- ja laiteroolien erottelu:**
    *   Ihmisroolit (Valmentaja, Urheilija, Katsomo) säilyttävät nimensä roolia vaihtaessa.
    *   Laiteroolit (Starttikello, Väliaika, Maali, Video) kysyvät ja tallentavat oman erillisen laitenimensä.
*   **Laitteen korvaaminen (Replacement):** Starttikello ja Maali sallivat nyt vain yhden aktiivisen laitteen kerrallaan. Uusi laite syrjäyttää edellisen saman roolin laitteen palvelimelta.
*   **Nimeämisohjeet:** Uudet dynaamiset ohjeet liittymisvaiheessa riippuen valitusta roolista.

## v1.4.2 - "YKSI-STARTTI" (2026-03-03)
*   **Rajoitettu nimeämispakko:** Vähennetty pakotettua laitenimeämistä vain niihin rooleihin, joita voi olla useampi (Väliaika & Video).
*   **Välimuistin hallinta:** Lisätty dynaaminen välimuistin ohitus (cache buster) `app.js`-tiedostolle selauspäivitysten varmistamiseksi.

## v1.4.1 - "VÄLIAIKA-VOITTO" (2026-03-03)
*   **Pakotettu nimeäminen laitteille:** Korjattu ongelma, jossa oma henkilökohtainen nimi siirtyi vahingossa radalla oleville laitteille.
*   **Käyttöliittymän resetointi:** Nimen valinta -ruutu tyhjenee nyt automaattisesti, kun palataan roolivalintaan.

## v1.4.0 - "TRIPLA-TUNTURI" (2026-03-03)
*   **Dynaaminen roolikohtainen nimeäminen:** Liittymisvaihe tunnistaa valitun roolin ja muokkaa ohjeet sen mukaan (esim. "Valitse väliaikapiste").
*   **Laitelistaukset:** Uusi laite voi liittyä vanhan laitteen nimellä valitsemalla sen pudotusvalikosta.

## v1.3.1 - "SUPI-STARTTI" (2026-03-03)
*   **Starttikellon nimeäminen:** "LÄHTÖ" muutettu selkeämmäksi "STARTTIKELLO" -muodoksi.
*   **Monen väliaikapisteen ja kameran tuki:**
    *   Palvelin tunnistaa laitteet `deviceName`-tunnisteen perusteella.
    *   Väliaikaliipaisu yhdistetään automaattisesti laskijaan, joka ei ole vielä kyseisestä pisteestä saanut aikaa.
*   **Monikameratuki:** Mahdollisuus hallita useita videolaitteita samanaikaisesti.

## v1.3.0 - "TUPLA-TUNTURI" (2026-03-03)
*   **Automaattinen nimenhallinta:** Järjestelmä tunnistaa saman nimiset urheilijat ja lisää nimen perään numeron (esim. "Matti 2").
*   **Manuaalinen lisäys:** Nimenhallinta toimii myös kun valmentaja lisää laskijan manuaalisesti.

## v1.2.0 - "HUIPPU-HANKI" (2026-03-02)
*   **LÄHTÖPAIKKA-roolin uudistus:** "Lähettäjä" vaihdettu "Lähtöpaikaksi".
*   **Jonon hallinta:** Uusi tapa vaihtaa seuraavaa lähtijää napauttamalla listalta.
*   **Ghost Start -esto:** Ajanotto ei käynnisty, jos "Seuraava lähtijä" -kohta on tyhjä.
*   **Automaattinen rotaatio:** Maaliin tullut laskija siirtyy automaattisesti listan loppuun.
*   **Deployment Splash Screen:** Visuaalinen vahvistus päivityksen onnistumisesta sovelluksen käynnistyessä.
