#!/usr/bin/env node
// LICENSE_CODE ZON ISC
'use strict'; /*jslint node:true, esnext:true*/
const yargs = require('yargs');
const Server = require('./server.js');
const args = process.argv.slice(2).map(String);
const path = require('path');
const os = require('os');
const fs = require('fs');
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'info';
process.env.LOG_TIME = 'abs';
const log = require('log');
require('log-node')();

const load_json = file_path=>{
    let s;
    try {
        s = fs.readFileSync(file_path).toString();
        s = s.replace(/^\uFEFF/, '');
        if (!s)
            return {};
        log.notice(`Loaded config ${file_path}`);
    } catch(e){
        log.error('Could not load file %s', e.message);
        log.notice('Using empty config');
        return {};
    }
    try {
        const res = JSON.parse(s);
        return res;
    } catch(e){
        const msg = `Failed parsing json file ${this.opt.filename}: `
            +`${e.message}`;
        throw msg;
    }
};

const load_config = file_path=>{
    const config = load_json(file_path);
    return Object.assign({_defaults: {}, proxies: []}, config);
};

const defaults = {
    dir: path.resolve(os.homedir(), 'luminati_proxy_manager'),
};
Object.assign(defaults, yargs(args).default(defaults).argv);
defaults.config = path.resolve(defaults.dir, '.luminati.json');

const run = ()=>{
    log.notice('Running L-LPM...');
    const argv = yargs(args).default(defaults).argv;
    const config = load_config(argv.config);
    const proxies = config.proxies.map(p=>
        Object.assign({}, config._defaults, p));
    const proxies_running = {};
    proxies.forEach(proxy=>{
        proxies_running[proxy.port] = new Server(proxy).listen();
    });
    process.on('uncaughtException', e=>{
        log.error(e.stack);
    });
    ['SIGTERM', 'SIGINT', 'uncaughtException'].forEach(sig=>{
        process.on(sig, e=>{
            for (const port in proxies_running)
                proxies_running[port].stop();
            setTimeout(()=>process.exit(), 1000);
        });
    });
};

run();

