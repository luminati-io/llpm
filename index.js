#!/usr/bin/env node
// LICENSE_CODE ZON ISC
'use strict'; /*jslint node:true, esnext:true*/
const yargs = require('yargs');
const Server = require('./server.js');
const args = process.argv.slice(2).map(String);
const path = require('path');
const os = require('os');
const fs = require('fs');

const load_json = path=>{
    let s;
    try {
        s = fs.readFileSync(path).toString();
        s = s.replace(/^\uFEFF/, '');
        if (!s)
            return {};
        console.log(`Loaded config ${path}`);
    } catch(e){
        console.error('Could not load file %s', e.message);
        console.log('Using empty config');
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
}

const load_config = path=>{
    const config = load_json(path);
    return Object.assign({_defaults: {}, proxies: []}, config);
};

const work_dir = args.dir ||
    path.resolve(os.homedir(), 'luminati_proxy_manager');
const defaults = {
    config: path.resolve(work_dir, '.luminati.json'),
};

const run = ()=>{
    const argv = yargs(args).default(defaults).argv;
    const config = load_config(argv.config);
    const proxies = config.proxies.map(p=>
        Object.assign({}, config._defaults, p));
    const proxies_running = {};
    proxies.forEach(proxy=>{
        proxies_running[proxy.port] = new Server(proxy).listen();
    });
    ['SIGTERM', 'SIGINT', 'uncaughtException'].forEach(sig=>{
        process.on(sig, e=>{
            for (const port in proxies_running)
                proxies_running[port].stop();
        });
    });
};

run();

