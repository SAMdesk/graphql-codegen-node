#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const argv = require('minimist')(process.argv.slice(2));
const codegen = require('./codegen');

if(!argv.config) {
    console.error('Missing required parameter: --config');
    process.exit(1);
}

const config_path = path.resolve(process.cwd(), argv.config);
const config = require(config_path);

codegen(config).then(() => {
    process.exit(0);
}).catch((err) => {
    console.error(err);
    process.exit(1);
});