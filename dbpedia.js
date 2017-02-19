'use strict';

const SparqlClient = require('sparql-client'),
    client = new SparqlClient('http://dbpedia.org/sparql'),
    fs = require('fs'),
    path = require('path'),
    request = require('request-promise'),
    _ = require('lodash');

const blacklist = JSON.parse(fs.readFileSync(path.normalize('./blacklist.json'))),
    prefixMap = JSON.parse(fs.readFileSync(path.normalize('./prefixes.json'))),
    prefixString = generatePrefixString(prefixMap);

generateQuestions(5);

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
        .then(values => multiFetchPropertyInfo(values.slice(0, numQuestionsPerEntity)))
        .then(values => {
            propertyInfos = values;
            return _.sortBy(_.keys(values));
        })
        .then(values => multiFetchCorrectAnswerValue(e, values))
        .then(values => {
            let sortedPropertyKeys = _.sortBy(_.keys(propertyInfos));
            values.forEach((v, i) => propertyInfos[sortedPropertyKeys[i]].correctAnswer = v);
            return propertyInfos;
        })
        .then(values => multiFetchAlternativeAnswers(propertyInfos))
        .then(values => {
            let sortedPropertyKeys = _.sortBy(_.keys(propertyInfos));
            values.forEach((v, i) => propertyInfos[sortedPropertyKeys[i]].alternativeAnswers = v);
        })
        .then(() => {
            console.log(1);
        })
        .catch(() => {
            console.log(1);
        });
}

function multiFetchAlternativeAnswers(propertyInfos) {
    let promises = [];
    _.sortBy(_.keys(propertyInfos)).forEach(key => promises.push(fetchAlternativeAnswers(propertyInfos[key])));
    return Promise.all(promises);
}

function fetchAlternativeAnswers(propertyInfo) {
    return new Promise((resolve, reject) => {
        switch (extractAnswerClass(propertyInfo)) {
            case 'year':
                randomYearAnswers(3, parseInt(propertyInfo.correctAnswer)).then(resolve);
                break;
            case 'int':
                randomNumericAnswers(3, parseInt(propertyInfo.correctAnswer), false).then(resolve);
                break;
            case 'float':
                randomNumericAnswers(3, parseFloat(propertyInfo.correctAnswer), true).then(resolve);
                break;
            default:
                reject();
        }
    });
}

// TODO: Use construct query instead of multiple sequential select queries.
function multiFetchCorrectAnswerValue(entityUri, propertyUris) {
    return new Promise((resolve, reject) => {
        let promises = [];
        propertyUris.forEach(uri => promises.push(fetchCorrectAnswerValue(entityUri, uri)));
        Promise.all(promises)
            .then(resolve)
            .catch(reject);
    });
}

function fetchCorrectAnswerValue(entityUri, propertyUri) {
    return new Promise((resolve, reject) => {
        propertyUri = propertyUri.indexOf('http://') > -1 ? '<' + propertyUri + '>' : propertyUri;
        entityUri = entityUri.indexOf('http://') > -1 ? '<' + entityUri + '>' : entityUri;
        client.query(prefixString + `SELECT ?answer WHERE { ?resource ?property ?answer }`)
            .bind('resource', entityUri)
            .bind('property', propertyUri)
            .execute((err, results) => {
                if (err || !results || !results.results || !results.results.bindings) return reject();
                resolve(results.results.bindings[0].answer.value);
            });
    });
}

// TODO: Use construct query instead of multiple sequential select queries.
function multiFetchPropertyInfo(propertyUris) {
    return new Promise((resolve, reject) => {
        let promises = [];
        propertyUris.forEach(uri => promises.push(fetchPropertyInfo(uri)));
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
        propertyUri = propertyUri.indexOf('http://') > -1 ? '<' + propertyUri + '>' : propertyUri;
        client.query(prefixString + `
        SELECT ?range ?label WHERE {
            ?property rdfs:label ?label .
            ?property rdfs:range ?range .
            FILTER(lang(?label) = "en")
        }`)
            .bind('property', propertyUri)
            .execute((err, results) => {
                if (err || !results || !results.results || !results.results.bindings || !results.results.bindings[0].label || !results.results.bindings[0].range) return reject();
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
    return _.keys(prefixes).map(k => `prefix ${k}: <${prefixes[k]}>\n`).toString().replace(/,/g, '');
}

function getRandomEntity() {
    //return 'dbr:Marie_Curie';
    return 'dbr:Boston';
}

function getTopEntityProperties(entityUri) {
    let dummyUri1 = 'https://api.myjson.com/bins/13c6t5'; // Boston
    let dummyUri2 = 'https://api.myjson.com/bins/dhjq1'; // Marie_Curie

    let opts = {
        uri: dummyUri1,
        qs: {
            entity: entityUri,
            alg: '8'
        },
        json: true
    };

    return request(opts)
        .then(results => Array.isArray(results) ? results : _.keys(results))
        .then(results => results.filter(v => !blacklist.includes(v)));
}

function extractAnswerClass(property) {
    if (property.range === 'http://www.w3.org/2001/XMLSchema#gYear') return 'year';
    else if (parseInt(property.correctAnswer.match(/^-?\d*(\d+)?$/)) > 0) return 'int';
    else if (parseFloat(property.correctAnswer.match(/^-?\d*(\.\d+)?$/)) > 0) return 'float';
    return null;
}

function randomYearAnswers(num, reference) {
    let before = Math.min(reference + 800, 2017);
    let after = reference - 800;

    let randoms = [];
    for (let i = 0; i < num; i++) {
        randoms.push(_.random(after, before, false));
    }
    return Promise.resolve(randoms);
}

function randomNumericAnswers(num, reference, float) {
    let oom = orderOfMagnitude(reference);
    let fixed = decimalPlaces(reference);

    let randoms = [];
    for (let i = 0; i < num; i++) {
        randoms.push(_.random(reference - Math.pow(10, oom - 1) * 9, reference + Math.pow(10, oom - 1) * 9, float).toFixed(fixed));
    }
    return Promise.resolve(randoms);
}

function orderOfMagnitude(n) {
    return Math.floor(Math.log(n) / Math.LN10 + 0.000000001);
}

function decimalPlaces(num) {
    var match = ('' + num).match(/(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/);
    if (!match) { return 0; }
    return Math.max(0, (match[1] ? match[1].length : 0) - (match[2] ? +match[2] : 0));
}