'use strict';

const express = require('express'),
    app = express(),
    generator = require('./generator');

app.get('/api/random', (req, res) => {
    generator.generateRandom().then((data) => {
        res.json(data);
    });
});

app.listen(3000, function() {
    console.log('Example app listening on port 3000!');
});