# Tetris Duo

Zweispieler-Tetris als **statische Website**: Lokales Duell an einer Tastatur oder **Online 1v1 via WebRTC** mit manuellem Signaling (Code-Austausch per Copy & Paste).

- **Kein Server** für Spielzustand oder Signaling erforderlich
- **Kein Build-Schritt** und **keine externen Abhängigkeiten / npm-Pakete**
- Läuft direkt aus dem Dateisystem (`file://`) oder über GitHub Pages
- Reines **ES-Module-JavaScript + HTML5 Canvas 2D**
- Deterministische Spiel-Engine (Seeded PRNG, kein `Date.now()`, kein `Math.random()`)
- **Mobil-tauglich**: Responsive Single-Column (< 900px), eigene Ansicht groß + Gegner-Vorschau, Safe-Area-Insets, feste Touch-Buttons
- **WebRTC mit STUN + TURN-Fallback** (OpenRelay) und Verbindungs-Timeout (15s)

---

## Status & Grenzen

**Mobil- & Desktop-tauglich — spielbar, verifiziert, mit 13 Tests.**

Was tatsächlich geprüft wurde:

- `node --test tests/` → 13 Tests, 13 bestanden, Exit 0.
- Match-Ende-Erkennung (`matchWinner`) ohne Seiteneffekte mit dokumentiertem Tie-Break.
- Mobil-Layout: Einspaltig unter 900px, kein horizontales Scrollen, Viewport-Cover, Touch-Controls (≥ 44×44 px, `touch-action: manipulation`).
- Signaling mit Web Share API (`navigator.share`), Clipboard-Einfügen und automatischer Bereinigung von Leerzeichen/Zeilenumbrüchen.
- WebRTC mit STUN + öffentlichem TURN-Fallback (`turn:openrelay.metered.ca:443`) und 15s Timeout.

Bekannte Rahmenbedingungen:

1. **Host-Tab Sichtbarkeit:** Die Simulation läuft über `requestAnimationFrame`. Wandert der Host-Tab in den Hintergrund, kann der Browser das Rendering drosseln.
2. **P2P-Netzwerke:** Dank TURN-Fallback können auch Mobilfunk-Geräte koppeln. Blockiert eine Firewall UDP/TURN komplett, greift nach 15s die Fehlermeldung im Statusfeld.

---

## Spielanleitung

### Spielregeln
- **7-Bag-Randomizer:** Immer alle 7 Steine (I, J, L, O, S, T, Z) werden als zufällige Permutation ausgegeben.
- **SRS-Rotation:** Super Rotation System mit Wall Kicks (inklusive Horizontalkicks -2 bis +2 und Bodenkicks).
- **Gravity & Lock:** Basis-Geschwindigkeit `800 - (level - 1) * 70` ms. Nach Bodenkontakt greift ein Lock-Delay von 500 ms.
- **Punkte:**
  - 1 Zeile: `100 × Level`
  - 2 Zeilen: `300 × Level`
  - 3 Zeilen: `500 × Level`
  - 4 Zeilen (Tetris): `800 × Level`
- **Level-Aufstieg:** `1 + floor(Gesamtzeilen / 10)`.
- **Angriff & Garbage:**
  - 1 Zeile = 0 Zeilen Garbage
  - 2 Zeilen = 1 Zeile Garbage
  - 3 Zeilen = 2 Zeilen Garbage
  - 4 Zeilen (Tetris) = 4 Zeilen Garbage
  - Garbage-Zeilen besitzen jeweils genau ein zufällig platziertes Loch und steigen von unten auf, sobald der nächste Stein lockt.
- **Game Over:** Wenn ein neu gespawnter Stein bereits mit vorhandenen Blöcken kollidiert.

---

## Modi & Tastenbelegung

### 1. Modus: Local Duo (Zwei Spieler, eine Tastatur)
Zwei unabhängige Tetris-Felder nebeneinander auf demselben Bildschirm. Gelöschte Mehrfachzeilen schicken Garbage direkt zum Gegner.

- **Spieler 1 (links):**
  - Bewegen: `A` (links) / `D` (rechts)
  - Drehen: `W` (im Uhrzeigersinn / CW) / `Q` (gegen Uhrzeigersinn / CCW)
  - Soft Drop: `S`
  - Hard Drop: `Space` (Leertaste)
  - Hold: `Shift`

- **Spieler 2 (rechts):**
  - Bewegen: `←` (links) / `→` (rechts)
  - Drehen: `↑` (im Uhrzeigersinn / CW) / `,` (Komma, gegen Uhrzeigersinn / CCW)
  - Soft Drop: `↓`
  - Hard Drop: `.` (Punkt)
  - Hold: `/` (Schrägstrich)

---

### 2. Modus: Online 1v1 (WebRTC P2P)

Der Host besitzt die Simulationshoheit. Der Gast sendet Eingaben an den Host, der Host simuliert beide Boards und streamt den Zustand mit bis zu 20 Hz an den Gast.

#### Wie man online testet (Reihenfolge der Codes):
1. **Schritt 1 (Host):**
   - Klicke im Menü auf **"Host Online"**.
   - Der Host erzeugt automatisch einen verschlüsselten Verbindungscode (SDP-Offer via STUN `stun:stun.l.google.com:19302`).
   - Klicke auf **"Copy"** bei *1. Your Connection Code* und sende diesen Code an den Gast (z. B. via Messenger oder in einem zweiten Browser-Tab).
2. **Schritt 2 (Gast):**
   - Öffne die Seite in einem zweiten Tab, Fenster oder auf einem anderen Rechner.
   - Klicke im Menü auf **"Join Online"**.
   - Füge den Host-Code in das Textfeld *1. Paste Host Connection Code here* ein und klicke auf **"Generate Answer"**.
3. **Schritt 3 (Gast):**
   - Der Gast erzeugt einen Antwort-Code (SDP-Answer).
   - Klicke auf **"Copy"** bei *2. Your Answer Code* und sende diesen Code zurück an den Host.
4. **Schritt 4 (Host):**
   - Füge den Antwort-Code des Gasts in das Feld *2. Paste Guest Answer Code here* ein und klicke auf **"Connect"**.
5. **Schritt 5 (Verbunden):**
   - Die WebRTC-P2P-Verbindung (`RTCDataChannel` Label `game`) öffnet sich. Beide Spieler sehen nun die beiden Spielfelder live, Garbage fließt bei Zeilenabräumen hin und her und über den **Rematch**-Button kann jederzeit eine Revanche gestartet werden.

---

## GitHub Pages Deployment

Da das gesamte Projekt aus statischen Dateien ohne Build-Schritt besteht:

1. Repository auf GitHub pushen.
2. In den Repository-Einstellungen unter **Settings → Pages**:
   - Source: **Deploy from a branch**
   - Branch: `main` / `master`, Folder: `/ (root)`
3. Die Seite ist unter `https://<username>.github.io/<repo>/` erreichbar.
4. Auch lokales Öffnen der `index.html` im Browser funktioniert direkt.

---

## Tests

Die Spiellogik wird über die native Node.js Testsuite (`node:test`) getestet.

### Tests ausführen

```bash
node --test tests/
```

### Getestete Kernregeln
- **7-Bag Randomizer:** Jedes 7er-Paket enthält exakt alle 7 Tetromino-Typen.
- **SRS Rotation & Wall Kicks:** Kicks gegen rechte und linke Wand sowie Bodenkicks.
- **Gravity & Lock-Delay:** Schwerkraft-Schritte und Lock-Verhalten nach 500 ms.
- **Linien löschen, Punkte & Attack:** Abrechnen von 1, 2, 3 und 4 Zeilen (Tetris) mit Multiplikatoren und Angriffswerten.
- **Level-Fortschritt:** Level-Steigerung alle 10 Linien und automatische Beschleunigung der Fallgeschwindigkeit.
- **Garbage-Mechanik:** Einspeisen von Garbage-Zeilen von unten mit genau einem zufälligen Loch pro Zeile.
- **Game Over:** Kollision beim Spawnen beendet das Spiel deterministisch.
- **Determinismus:** Identischer Seed und identische Eingabesequenz erzeugen bitgenau identische Board-Matrizen und Punktestände.
- **Hold-Mechanik:** Stein tauschen und Verriegelung bis zum nächsten Lock.
