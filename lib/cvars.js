'use strict';

// Bruecke zum gemeinsamen Cvar-Modell (Browser-ESM) fuer den Server.
// require(esm) ist ab Node 22.12 ohne Flag verfuegbar; public/js/package.json
// setzt "type": "module", damit die Datei dort als ESM geladen wird.
// Modell, Ranges und Defaults liegen NUR in public/js/cvars.js — hier nichts duplizieren.
module.exports = require('../public/js/cvars.js');
