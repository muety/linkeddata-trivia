'use strict';

const SparqlClient = require('sparql-client'),
    client = new SparqlClient('http://dbpedia.org/sparql'),
    fs = require('fs'),
    path = require('path'),
    request = require('request-promise'),
    _ = require('lodash');

const blacklist = JSON.parse(fs.readFileSync(path.normalize('./resources/blacklist.json'))),
    prefixMap = JSON.parse(fs.readFileSync(path.normalize('./resources/prefixes.json'))),
    inversePrefixMap = _.invert(prefixMap),
    sortedClasses = JSON.parse(fs.readFileSync(path.normalize('./resources/classes_sorted.json'))),
    prefixString = generatePrefixString(prefixMap);

generateQuestions(1).then(console.log);

/* Currently only supports to generate 1 question at a time. */
function generateQuestions(num) {
    /* 
    Step 1: Get relevant properties for this entity
    Step 2: Combine relevant properties with those actually available and fetch meta data for them 
    Step 3: Get entity label
    Step 4: Fetch actual value for the specific entity and property to be the correct answer
    Step 5: Generate or fetch 3 alternative answers. For dates, years and numbers random values within an interval are generated. For resources values the labels of three other entities within the same class are fetched. Plain string and other types are ignored for now.
    */

    let promises = [];
    let propertyInfos = {};
    let entity = getRandomEntity();
    let entityLabel = '';

    promises.push(fetchEntityProperties(entity));
    promises.push(getTopEntityProperties(entity, true));

    return Promise.all(promises)
        .then(values => _.intersection(values[0], values[1]))
        .then(values => multiFetchPropertyInfo(values.slice(0, num)))
        .then(values => { propertyInfos = values; })
        .then(() => fetchLabel(entity))
        .then(label => {
            entityLabel = label;
        })
        .then(() => multiFetchCorrectAnswerValue(entity, _.sortBy(_.keys(propertyInfos))))
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
            console.log(`[INFO] Fetched data for entity ${entity}.`);
        })
        .then(() => {
            let prop = propertyInfos[_.keys(propertyInfos)[0]]; // Only support one at a time for now
            return {
                q: `What is the ${prop.label} of ${entityLabel}?`,
                correctAnswer: prop.correctAnswer,
                alternativeAnswers: prop.alternativeAnswers
            };
        })
        .catch((e) => {
            console.log(`[INFO] Failed to fetch complete data for entity ${entity}. Retrying another one.`);
            return generateQuestions(num);
        });
}

function multiFetchAlternativeAnswers(propertyInfos) {
    let promises = [];
    _.sortBy(_.keys(propertyInfos)).forEach(key => promises.push(fetchAlternativeAnswers(propertyInfos[key])));
    return Promise.all(promises);
}

function fetchAlternativeAnswers(propertyInfo) {
    return new Promise((resolve, reject) => {
        let answerClass = extractAnswerClass(propertyInfo);
        switch (answerClass) {
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
                if (_.keys(sortedClasses).includes(toPrefixedUri(answerClass))) randomClassAnswers(3, answerClass).then(resolve);
                else reject();
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
        client.query(prefixString + `SELECT ?answer WHERE {
            ?resource ?property ?answerRes .
            ?answerRes rdfs:label ?answer .
            FILTER(lang(?answer) = "en")
        }`)
            .bind('resource', entityUri)
            .bind('property', propertyUri)
            .execute((err, results) => {
                if (err || !results || !results.results.bindings.length) return reject();
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

function fetchLabel(entityUri) {
    return new Promise((resolve, reject) => {
        entityUri = entityUri.indexOf('http://') == 0 ? '<' + entityUri + '>' : entityUri;
        client.query(prefixString + `
        SELECT ?label WHERE {
            ?entity rdfs:label ?label .
            FILTER(lang(?label) = "en")
        }`)
            .bind('entity', entityUri)
            .execute((err, results) => {
                if (err || !results || !results.results.bindings.length) return reject();
                resolve(results.results.bindings[0].label.value);
            });
    });
}

function fetchPropertyInfo(propertyUri) {
    return new Promise((resolve, reject) => {
        propertyUri = propertyUri.indexOf('http://') == 0 ? '<' + propertyUri + '>' : propertyUri;
        client.query(prefixString + `
        SELECT ?range ?label WHERE {
            ?property rdfs:label ?label .
            ?property rdfs:range ?range .
            FILTER(lang(?label) = "en")
        }`)
            .bind('property', propertyUri)
            .execute((err, results) => {
                if (err || !results || !results.results.bindings.length) return reject();
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
    return 'dbr:Marie_Curie';
    //return 'dbr:Boston';
}

function getTopEntityProperties(entityUri, randomPickOne) {
    let dummyUri1 = 'https://api.myjson.com/bins/13c6t5'; // Boston
    let dummyUri2 = 'https://api.myjson.com/bins/dhjq1'; // Marie_Curie

    let opts = {
        uri: dummyUri2,
        qs: {
            entity: entityUri,
            alg: '8'
        },
        json: true
    };

    return request(opts)
        .then(results => Array.isArray(results) ? results : _.keys(results))
        .then(results => results.filter(v => !blacklist.includes(v)))
        .then(results => randomPickOne ? [results[_.random(0, results.length - 1, false)]] : results);
}

function extractAnswerClass(property) {
    if (property.range === 'http://www.w3.org/2001/XMLSchema#gYear') return 'year';
    else if (parseInt(property.correctAnswer.match(/^-?\d*(\d+)?$/)) > 0) return 'int';
    else if (parseFloat(property.correctAnswer.match(/^-?\d*(\.\d+)?$/)) > 0) return 'float';
    else return property.range;
}

function randomYearAnswers(num, reference) {
    let before = Math.min(reference + 200, 2017);
    let after = reference - 200;

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

function randomClassAnswers(num, classUri) {
    let promises = [];
    classUri = classUri.indexOf('http://') == 0 ? '<' + classUri + '>' : classUri;

    for (let i = 0; i < num; i++) {
        promises.push(new Promise((resolve, reject) => {
            client.query(prefixString + ` 
                SELECT ?e WHERE {
                    ?r rdf:type ?class .
                    ?r rdfs:label ?e .
                    FILTER(lang(?e) = "en")
                } 
                OFFSET ${_.random(0, getClassCount(classUri) - 1, false)} 
                LIMIT 1`)
                .bind('class', classUri)
                .execute((err, results) => {
                    if (err || !results || !results.results.bindings.length) return reject();
                    resolve(results.results.bindings[0].e.value);
                });
        }));
    }
    return Promise.all(promises);
}

function orderOfMagnitude(n) {
    return Math.floor(Math.log(n) / Math.LN10 + 0.000000001);
}

function decimalPlaces(num) {
    var match = ('' + num).match(/(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/);
    if (!match) { return 0; }
    return Math.max(0, (match[1] ? match[1].length : 0) - (match[2] ? +match[2] : 0));
}

function getClassCount(classUri) {
    return sortedClasses[toPrefixedUri(classUri)];
}

function toPrefixedUri(uri) {
    uri = uri.replace(/</, '').replace(/>/, '');
    let prefix = _.keys(inversePrefixMap).filter(k => uri.indexOf(k) > -1)[0];
    let shortUri = uri.replace(prefix, inversePrefixMap[prefix] + ':');
    return shortUri;
}