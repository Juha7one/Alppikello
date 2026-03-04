# Alppikello Muutoshistoria

Tämä tiedosto sisältää kuvauksen kaikista Alppikello-projektin merkittävistä päivityksistä ja ominaisuusmuutoksista.

## v1.8.8 - "VIDEO-TESTI" (2026-03-04)
*   **Video-kameratila:** Lisätty VIDEO-roolille oma kameranäkymä ja CV-liikkeentunnistuksen testausmahdollisuus.
*   **Avoimet silmät:** Nyt videolaite voi avata oman kameransa ja valmistautua puskuroituun tallennukseen.
*   **Keskityskorjaukset:** Viimeistelty käyttöliittymän keskitystä mobiililaitteilla.

## v1.8.3 - "NAME-FIX" (2026-03-04)
*   **Nimen vaihto korjattu:** Nimen vaihto -painike aktivoi nyt oikeaoppisesti asennusnäkymän, jolloin käyttäjä voi vaihtaa nimensä kesken harjoituksen.

## v1.8.2 - "CENTER-FIX" (2026-03-04)
*   **Absoluuttinen keskitys:** Päivitetty CSS-säiliöt käyttämään `align-items: center` ja `text-align: center` pakotuksia. Tämä takaa, että roolivalinta ja logo ovat täsmälleen keskellä myös iOS Safarilla.
*   **Lovituki (Notch):** Lisätty dynaamiset sivupaddingit (`safe-area-inset-left/right`), jotta sisältö ei valu reunoista yli, kun puhelin on vaaka-asennossa.

## v1.8.1 - "LÄHISTÖ-FIX" (2026-03-04)
*   **Discovery-korjaus:** Korjattu bugi, jossa harjoituksen luoja (admin) ei automaattisesti reksitöitynyt laitelistalle. Tämä esti harjoituksen sijainnin pivityksen ja siten sen näkymisen muille "Lähistöllä olevat" -listassa.
*   **GPS-varmistus:** Varmistettu, että admin-laite alkaa heti lähettää koordinaatteja harjoituksen luonnin jälkeen.

## v1.8.0 - "BUG-FIX" (2026-03-04)
*   **Näkymäkorjaus:** Korjattu kriittinen HTML-rakennevirhe, jossa valmentajanäkymä oli vahingossa jäänyt väliaikanäkymän sisälle. Tämä aiheutti mustan ruudun harjoitusta luotaessa.
*   **Versiopäivitys:** Valmistaudutaan videologikan integrointiin.

## v1.7.9 - "MOBILE-FIX" (2026-03-04)
*   **iOS Notch -tuki:** Lisätty `viewport-fit=cover` ja dynaamiset `safe-area-inset` -paddingit, jotta käyttöliittymä ei jää loven alle.
*   **Keskityskorjaus:** Pienennetty korttien paddingia ja optimoitu säiliöiden leveydet, jotta sisältö pysyy täydellisesti keskellä kaikilla iPhone-malleilla.
*   **Layout-parannus:** Varmistettu, että rooliruudukko ei aiheuta sivuttaista skrollausta pienillä näytöillä.

## v1.7.8 - "HANSKAYSTÄVÄLLINEN" (2026-03-04)
*   **Iso lopetuspainike:** Valmentajan "Lopeta treeni" -painike on siirretty alareunaan ja tehty huomattavasti suuremmaksi, jotta sitä on helppo käyttää hanskat kädessä.
*   **iOS-Layout korjaus:** Roolivalinnan ruudukkoa on parannettu käyttämällä `aspect-ratio: 1/1` -asetusta, mikä varmistaa symmetriset ja toimivat painikkeet kaikilla iOS-laitteilla.
*   **Parempi keskitys:** Kaikki aloitussivun ja roolivalinnan elementit on pakotettu täydellisesti keskelle näyttöä.

## v1.7.6 - "VIILAUKSET" (2026-03-04)
*   **Keskityskorjaus:** Roolivalinnan ruudukko ja otsikko on nyt keskitetty kauniisti näytön keskelle.
*   **Ruudukon viilaus:** Optimoitu roolikorttien kokoa ja välejä mobiilikäytön helpottamiseksi.

## v1.7.5 - "LÄHISTÖ-LIITTYMINEN" (2026-03-04)
*   **Discovery-toiminto:** Tunnistaa GPS:n avulla lähistöllä (5km) olevat aktiiviset harjoitukset ja tarjoaa niitä listana aloitussivulla.
*   **Laitteiden Hallinta:** Valmentajan näkymä näyttää nyt kaikki yhdistetyt laitteet (valmentajat, laskijat, katsomo) kategorisoituna.
*   **GPS-korjaus:** Parannettu GPS-datan päivitystä ja visualisointia laitelistassa.

## v1.7.4 - "GPS-MONITORI" (2026-03-04)
*   **GPS-Visualisointi:** Valmentajan laitelistassa näkyy nyt kunkin laitteen tarkat GPS-koordinaatit ja mittaustarkkuus.
*   **Seurantavalmius:** Tämä helpottaa radan kalibrointia ja laitteiden sijoittelun varmistamista.

## v1.7.3 - "HIENOSÄÄTÖ" (2026-03-04)
*   **Katsomo-näkymän korjaus:** Katsomo-roolilla näkyy nyt selkeästi "KATSOMO / LIVE" -otsikko valmentaja-näkymän sijaan.
*   **Nimen vaihtaminen:** Lisätty mahdollisuus vaihtaa omaa nimeä suoraan sovelluksen alareunasta ilman sivun uudelleenlatausta.
*   **Keskityskorjaus:** Korjattu mobiilikäyttöliittymän nappien ja elementtien keskitys pystyasennossa.

## v1.7.2 - "HYBRID-MALLI" (2026-03-04)
*   **Hybridiratkaisu:** Sovelluksen käyttöliittymä hostattu `luodut.com`:ssa ja kello-moottori (backend) `render.com`:ssa.
*   **CORS-valmius:** Palvelin sallii nyt ristiinyhteydet eri domaineista.
*   **Dynaaminen palvelinosoite:** Sovellus tunnistaa ympäristön ja yhdistää automaattisesti oikeaan taustajärjestelmään.

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
