'use strict';

const express = require('express'),
    app = express(),
    generator = require('./generator');

app.use(express.static('public'));

app.get('/api/random', (req, res) => {
    generator.generateRandom().then((data) => {
        res.json(data);
    });
});

app.listen(8898, function() {
    console.log('Example app listening on port 3000!');
});