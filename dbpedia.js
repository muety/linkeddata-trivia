'use strict';

const SparqlClient = require('sparql-client'),
    client = new SparqlClient('http://dbpedia.org/sparql'),
    fs = require('fs'),
    path = require('path'),
    request = require('request-promise'),
    _ = require('lodash');

const prefixMap = JSON.parse(fs.readFileSync(path.normalize('./prefixes.json'))),
    prefixString = generatePrefixString(prefixMap);

generateQuestions(2);

function generateQuestions(numQuestionsPerEntity) {
    /* 
    Step 1: Get relevant properties for this entity
    Step 2: Combine relevant properties with those actually available and fetch meta data for them 
    */

    let promises = [];
    let propertyInfos = {};
    let e = getRandomEntity();

    promises.push(fetchEntityProperties(e));
    promises.push(getTopEntityProperties(e));

    Promise.all(promises)
        .then(values => _.intersection(values[0], values[1]))
        .then(values => fetchPropertiesInfos(values.slice(0, numQuestionsPerEntity)))
        .then(values => { propertyInfos = values; })
        .then(() => {
            console.log(1);
        })
        .catch(() => {
            console.log(1);
        });
}

function fetchCorrectAnswerValue(entityUri, propertyUri) {
    return new Promise((resolve, reject) => {
        client.query(prefixString + `SELECT ?answer WHERE { ?resource ?property ?answer }`)
            .bind('resource', entityUri)
            .bind('property', propertyUri)
            .execute((err, results) => {
                if (err || !results || !results.results || !results.results.bindings) return reject();
                resolve(results.results.bindings[0].answer.value);
            });
    });
}

function fetchPropertiesInfos(propertyUris) {
    return new Promise((resolve, reject) => {
        let promises = [];
        propertyUris.map(uri => uri.indexOf('http://') > -1 ? '<' + uri + '>' : uri).forEach(uri => promises.push(fetchPropertyInfo(uri)));
        Promise.all(promises)
            .then((results) => {
                return results.reduce((acc, val, i) => {
                    acc[propertyUris[i]] = val;
                    return acc;
                }, {});
            })
            .then(resolve)
            .catch(reject);
    });
}

function fetchPropertyInfo(propertyUri) {
    return new Promise((resolve, reject) => {
        client.query(prefixString + `
        SELECT ?range ?label WHERE {
            ?property rdfs:label ?label .
            ?property rdfs:range ?range .
            FILTER(lang(?label) = "en")
        }`)
            .bind('property', propertyUri)
            .execute((err, results) => {
                if (err || !results || !results.results || !results.results.bindings) return reject();
                resolve({
                    label: results.results.bindings[0].label.value,
                    range: results.results.bindings[0].range.value
                });
            });
    });
}

function fetchEntityProperties(entityUri) {
    return new Promise((resolve, reject) => {
        client.query(prefixString + 'SELECT DISTINCT(?p) WHERE { ?resource ?p _:bn }')
            .bind('resource', entityUri)
            .execute((err, results) => {
                if (err) return reject();
                let properties = results.results.bindings.map(b => b.p.value);
                resolve(properties);
            });
    });
}

function generatePrefixString(prefixes) {
    return Object.keys(prefixes).map(k => `prefix ${k}: <${prefixes[k]}>\n`).toString().replace(/,/g, '');
}

function getRandomEntity() {
    return 'dbr:Marie_Curie';
}

function getTopEntityProperties(entityUri) {
    let opts = {
        uri: 'https://api.myjson.com/bins/dhjq1',
        qs: {
            entity: entityUri,
            alg: '8'
        },
        json: true
    };

    return request(opts).then(results => Array.isArray(results) ? results : Object.keys(results));
}