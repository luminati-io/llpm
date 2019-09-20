#!/usr/bin/env node
// LICENSE_CODE ZON ISC
'use strict'; /*jslint node:true, esnext:true*/
const https = require('https');
const http = require('http');
const http_shutdown = require('http-shutdown');
const log = require('log');

const ensure_socket_close = socket=>{
    if (socket instanceof http.ClientRequest ||
        socket instanceof http.ServerResponse)
    {
        socket = socket.socket;
    }
    if (!socket || socket.destroyed)
        return;
    socket.end();
    setTimeout(()=>{
        if (!socket.destroyed)
            socket.destroy();
    }, 10*1000);
};

const write_http_reply = (client_res, proxy_res, headers={}, opt={})=>{
    headers = Object.assign(headers, proxy_res.headers||{});
    if (client_res.cred && opt.debug!='none')
        headers['x-llpm-authorization'] = client_res.cred;
    client_res.resp_written = true;
    if (client_res instanceof http.ServerResponse)
    {
        try {
            client_res.writeHead(proxy_res.statusCode,
                proxy_res.statusMessage, headers);
        } catch(e){
            if (e.code!='ERR_INVALID_CHAR')
                throw e;
            client_res.writeHead(proxy_res.statusCode,
                proxy_res.statusMessage, headers);
        }
        if (opt.end)
            client_res.end();
        return;
    }
    let head = `HTTP/1.1 ${proxy_res.statusCode} ${proxy_res.statusMessage}`
        +`\r\n`;
    for (let field in headers)
        head += `${field}: ${headers[field]}\r\n`;
    try {
        client_res.write(head+'\r\n', ()=>{
            if (opt.end)
                client_res.end();
        });
    } catch(e){
        e.message = (e.message||'')+`\n${head}`;
        throw e;
    }
};

class Server {
    constructor(opt){
        this.opt = opt;
        this.listen = this.listen.bind(this);
        this.stop = this.stop.bind(this);
        this.handler = this.handler.bind(this);
        this.get_headers = this.get_headers.bind(this);
        this.get_username = this.get_username.bind(this);
        this.handle_proxy_resp = this.handle_proxy_resp.bind(this);
        this.handle_proxy_connect = this.handle_proxy_connect.bind(this);
        this.handle_proxy_error = this.handle_proxy_error.bind(this);
        this.handle_proxy_timeout = this.handle_proxy_timeout.bind(this);
        this.request_handler = this.request_handler.bind(this);
        this.send_request = this.send_request.bind(this);
        this.reply_error = this.reply_error.bind(this);
        this.abort_proxy_req = this.abort_proxy_req.bind(this);
        this.session_id = 1;
        this.agent = new https.Agent({
            keepAlive: true,
            keepAliveMsecs: 5000,
            servername: 'zproxy.luminati.io',
        });
    }
    listen(){
        this.server = http.createServer((req, res)=>{
            if (!req.url.startsWith('http:'))
                req.url = 'http://'+req.headers.host+req.url;
            this.handler(req, res);
        }).on('connection', socket=>socket.setNoDelay());
        http_shutdown(this.server);
        this.server.on('error', e=>{
            log.error('server error: %s', e.message);
        });
        this.server.on('connect', (req, res, head)=>{
            this.handler(req, res, head);
        });
        this.server.listen(this.opt.port, '0.0.0.0', ()=>{
            log.notice('Port %s ready', this.opt.port);
        });
        return this;
    }
    stop(){
        if (this.stopped)
            return;
        this.stopped = true;
        this.server.forceShutdown(()=>{
            log.notice('server %s stopped', this.opt.port);
        });
    }
    handler(req, res, head){
        res.on('error', e=>{
            log.error('client: %s', e.message);
        });
        req.on('error', err=>{
            log.error('req error: %s', err.message);
        });
        this.send_request(req, res, head);
    }
    get_username(){
        const {customer, zone} = this.opt;
        return `lum-customer-${customer}-zone-${zone}-session-`+
            this.session_id++;
    }
    get_headers(req_headers, res){
        const username = this.get_username();
        res.cred = username;
        const auth = Buffer.from(username+':'+this.opt.password)
            .toString('base64');
        return Object.assign({}, req_headers, {
            'proxy-authorization': 'Basic '+auth,
            'x-hola-agent': 'proxy=1.152.672 node=v8.11.2 platform=linux',
        });
    }
    handle_proxy_resp(req, res, proxy){
        return proxy_res=>{
            log.info('%s %s: %s', req.method, req.url, proxy_res.statusCode);
            write_http_reply(res, proxy_res);
            proxy_res.pipe(res);
            proxy_res.on('error', e=>log.error('proxy_res e %s', e.message));
        };
    }
    handle_proxy_connect(req, res, proxy, head){
        return (proxy_res, socket, proxy_head)=>{
            log.info('%s %s: %s', req.method, req.url, proxy_res.statusCode);
            write_http_reply(res, proxy_res, {});
            if (proxy_res.statusCode!=200)
            {
                res.end();
                return;
            }
            res.write(proxy_head);
            socket.write(head);
            socket.pipe(res).pipe(socket);
            proxy_res.on('error', e=>{
                log.error('AFTER CONNECT: proxy_res error: %s', e.message);
            });
            socket.on('error', e=>{
                log.error('AFTER CONNECT: socket error: %s', e.message);
            });
        };
    }
    handle_proxy_error(req, res, proxy){
        return err=>{
            log.error('%s %s: %s', req.method, req.url, err.message);
            this.reply_error(res, err);
            this.abort_proxy_req(req, proxy);
        };
    }
    handle_proxy_timeout(proxy){
        return ()=>{
            ensure_socket_close(proxy);
        };
    }
    request_handler(req, res, proxy, head){
        res.on('close', ()=>{
            this.abort_proxy_req(req, proxy);
            log.debug('res closed');
        });
        req.on('close', ()=>{
            this.abort_proxy_req(req, proxy);
            log.debug('req closed');
        });
        proxy.setTimeout(120*1000);
        proxy.on('response', this.handle_proxy_resp(req, res, proxy))
        .on('connect', this.handle_proxy_connect(req, res, proxy, head))
        .on('error', this.handle_proxy_error(req, res, proxy))
        .once('timeout', this.handle_proxy_timeout(proxy))
        .on('close', ()=>{
            log.debug('proxy closed');
        });
    }
    send_request(req, res, head){
        log.debug('%s %s', req.method, req.url);
        const proxy = https.request({
            agent: this.agent,
            host: this.opt.proxy,
            port: this.opt.proxy_port,
            method: req.method,
            path: req.url,
            headers: this.get_headers(req.headers, res),
            rejectUnauthorized: false,
        });
        if (req.method=='CONNECT')
            proxy.end();
        else
        {
            req.pipe(proxy);
            req.on('end', req._onend = ()=>{
                if (!proxy.aborted)
                    proxy.end();
            });
        }
        this.request_handler(req, res, proxy, head);
    }
    reply_error(res, err){
        if (res.ended || res.destroyed)
            return;
        const headers = {
            Connection: 'close',
            'x-llpm-error': err.message,
        };
        try {
            write_http_reply(res, {
                statusCode: 502,
                headers,
                statusMessage: 'LPM - Bad Gateway',
            }, undefined, {end: true});
        } catch(e){
            console.error('could not send head: %s\n%s', e.message);
        }
    }
    abort_proxy_req(req, proxy){
        req.unpipe(proxy);
        proxy.abort();
        proxy.destroy();
    }
}

module.exports = Server;
