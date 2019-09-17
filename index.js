#!/usr/bin/env node
// LICENSE_CODE ZON ISC
'use strict'; /*jslint node:true, esnext:true*/
const yargs = require('yargs');
const args = process.argv.slice(2).map(String);
const argv = yargs(args).argv;

console.log(argv);
