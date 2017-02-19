'use strict';

const SPARQL_ENDPOINT = 'http://dbpedia.org/sparql',
    //RANKING_ENDPOINT = 'http://80.241.215.122:8899/api/ranking';
    RANKING_ENDPOINT = 'http://localhost:8080/api/ranking';

const SparqlClient = require('sparql-client'),
    client = new SparqlClient(SPARQL_ENDPOINT),
    fs = require('fs'),
    path = require('path'),
    request = require('request-promise'),
    _ = require('lodash');

const blacklist = JSON.parse(fs.readFileSync(path.normalize('./resources/blacklist.json'))),
    prefixMap = JSON.parse(fs.readFileSync(path.normalize('./resources/prefixes.json'))),
    inversePrefixMap = _.invert(prefixMap),
    sortedClasses = JSON.parse(fs.readFileSync(path.normalize('./resources/classes_sorted.json'))),
    prefixString = generatePrefixString(prefixMap);

let numTotalEntities = _.keys(sortedClasses).reduce((acc, val) => acc + sortedClasses[val], 0);

generateQuestions(1).then(console.log);

/* Currently only supports to generate 1 question at a time. */
function generateQuestions(num) {
    /* 
    Step 1: Get random entity from DBPedia
    Step 2: Get entity label    
    Step 3: Get relevant properties for this entity
    Step 4: Combine relevant properties with those actually available and fetch meta data for them 
    Step 5: Fetch actual value for the specific entity and property to be the correct answer
    Step 6: Generate or fetch 3 alternative answers. For dates, years and numbers random values within an interval are generated. For resources values the labels of three other entities within the same class are fetched. Plain string and other types are ignored for now.
    */

    let promises = [];
    let propertyInfos = {};
    let entity = null;
    let entityLabel = '';

    return fetchRandomEntity()
        .then(e => { entity = e; })
        .then(() => fetchLabel(entity))
        .then(label => { entityLabel = label; })
        .then(() => {
            let promises = [];
            promises.push(fetchEntityProperties(entity));
            promises.push(getTopEntityProperties(entity, entityLabel));
            return Promise.all(promises);
        })
        .then(values => _.intersection(values[0], values[1]))
        .then(values => [values[_.random(0, values.length - 1, false)]]) // only select one property at a time
        .then(values => multiFetchPropertyInfo(values.slice(0, num)))
        .then(values => { propertyInfos = values; })
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
            console.log(`\n[INFO] Fetched data for entity ${entity}.\n`);
            let prop = propertyInfos[_.keys(propertyInfos)[0]]; // Only support one at a time for now
            return {
                q: `What is the ${prop.label} of ${entityLabel}?`,
                correctAnswer: prop.correctAnswer,
                alternativeAnswers: prop.alternativeAnswers
            };
        })
        .catch((e) => {
            console.log(`\n[INFO] Failed to fetch complete data for entity ${entity}. Retrying another one. (${e})\n`);
            return generateQuestions(num);
        });
}

function multiFetchAlternativeAnswers(propertyInfos) {
    console.time('multiFetchAlternativeAnswers');
    let promises = [];
    _.sortBy(_.keys(propertyInfos)).forEach(key => promises.push(fetchAlternativeAnswers(propertyInfos[key])));
    return Promise.all(promises)
        .then(values => {
            console.timeEnd('multiFetchAlternativeAnswers');
            return values;
        });
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
                else reject(1);
        }
    });
}

// TODO: Use construct query instead of multiple sequential select queries.
function multiFetchCorrectAnswerValue(entityUri, propertyUris) {
    console.time('multiFetchAlternativeAnswers');
    let promises = [];
    propertyUris.forEach(uri => promises.push(fetchCorrectAnswerValue(entityUri, uri)));
    return Promise.all(promises)
        .then(values => {
            console.timeEnd('multiFetchAlternativeAnswers');
            return values;
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
                if (err || !results || !results.results.bindings.length) return reject(2);
                resolve(results.results.bindings[0].answer.value);
            });
    });
}

// TODO: Use construct query instead of multiple sequential select queries.
function multiFetchPropertyInfo(propertyUris) {
    console.time('multiFetchPropertyInfo');
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
            .then(values => {
                console.timeEnd('multiFetchPropertyInfo');
                return values;
            })
            .then(resolve)
            .catch(reject);
    });
}

function fetchPropertyInfo(propertyUri) {
    return new Promise((resolve, reject) => {
        if (!propertyUri) return reject(9);
        propertyUri = propertyUri.indexOf('http://') == 0 ? '<' + propertyUri + '>' : propertyUri;
        client.query(prefixString + `
            SELECT ?range ?label WHERE {
                ?property rdfs:label ?label .
                ?property rdfs:range ?range .
                FILTER(lang(?label) = "en")
            }`)
            .bind('property', propertyUri)
            .execute((err, results) => {
                if (err || !results || !results.results.bindings.length) return reject(4);
                resolve({
                    label: results.results.bindings[0].label.value,
                    range: results.results.bindings[0].range.value
                });
            });
    });
}

function fetchEntityProperties(entityUri) {
    console.time('fetchEntityProperties');
    return new Promise((resolve, reject) => {
        client.query(prefixString + `SELECT DISTINCT(?p) WHERE {
                ?resource ?p _:bn1 .
                ?p rdfs:label _:bn2
            }`)
            .bind('resource', entityUri)
            .execute((err, results) => {
                console.timeEnd('fetchEntityProperties');
                if (err) return reject(5);
                let properties = results.results.bindings.map(b => b.p.value);
                resolve(properties);
            });
    });
}

function fetchLabel(entityUri) {
    console.time('fetchLabel');
    return new Promise((resolve, reject) => {
        entityUri = entityUri.indexOf('http://') == 0 ? '<' + entityUri + '>' : entityUri;
        client.query(prefixString + `
            SELECT ?label WHERE {
                ?entity rdfs:label ?label .
                FILTER(lang(?label) = "en")
            }`)
            .bind('entity', entityUri)
            .execute((err, results) => {
                console.timeEnd('fetchLabel')
                if (err || !results || !results.results.bindings.length) return reject(3);
                resolve(results.results.bindings[0].label.value);
            });
    });
}


function generatePrefixString(prefixes) {
    return _.keys(prefixes).map(k => `prefix ${k}: <${prefixes[k]}>\n`).toString().replace(/,/g, '');
}

function fetchRandomEntity() {
    console.time('fetchRandomEntity');
    return new Promise((resolve, reject) => {
        client.query(prefixString + `SELECT ?e WHERE { 
                ?e _:bn1 _:bn2 . 
                ?e dbo:wikiPageID _:bn3 .
                ?e rdfs:label _:bn4 
            } 
            OFFSET ${_.random(0, numTotalEntities)} 
            LIMIT 1`)
            .execute((err, results) => {
                console.timeEnd('fetchRandomEntity');
                if (err || !results || !results.results.bindings.length) return reject(6);
                resolve(toPrefixedUri(results.results.bindings[0].e.value));
            });
    });
}

function getTopEntityProperties(entityUri, entityLabel) {
    console.time('getTopEntityProperties');

    let opts = {
        uri: RANKING_ENDPOINT,
        qs: {
            q: entityLabel,
            top: 50
        },
        json: true
    };

    return request(opts)
        .then(results => Array.isArray(results) ? results : _.keys(results))
        .then(results => results.filter(v => !blacklist.includes(v)))
        .then(results => results.filter(v => v.indexOf('/property/') === -1)) // dbp:-properties don't have ranges and labels
        .then(results => {
            console.timeEnd('getTopEntityProperties');
            return results;
        });
}

function extractAnswerClass(property) {
    if (property.range === 'http://www.w3.org/2001/XMLSchema#gYear') return 'year';
    else if (parseInt(property.correctAnswer.match(/^-?\d*(\d+)?$/)) > 0) return 'int';
    else if (parseFloat(property.correctAnswer.match(/^-?\d*(\.\d+)?$/)) > 0) return 'float';
    else return property.range;
}

function randomYearAnswers(num, reference) {
    console.time('randomYearAnswers');

    let before = Math.min(reference + 200, 2017);
    let after = reference - 200;

    let randoms = [];
    for (let i = 0; i < num; i++) {
        randoms.push(_.random(after, before, false));
    }
    console.timeEnd('randomYearAnswers');
    return Promise.resolve(randoms);
}

function randomNumericAnswers(num, reference, float) {
    console.time('randomNumericAnswers');

    let oom = orderOfMagnitude(reference);
    let fixed = decimalPlaces(reference);

    let randoms = [];
    for (let i = 0; i < num; i++) {
        randoms.push(_.random(reference - Math.pow(10, oom - 1) * 9, reference + Math.pow(10, oom - 1) * 9, float).toFixed(fixed));
    }
    console.timeEnd('randomNumericAnswers');
    return Promise.resolve(randoms);
}

function randomClassAnswers(num, classUri) {
    let promises = [];
    classUri = classUri.indexOf('http://') == 0 ? '<' + classUri + '>' : classUri;

    console.time('randomClassAnswers');
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
                    if (err || !results || !results.results.bindings.length) return reject(7);
                    resolve(results.results.bindings[0].e.value);
                });
        }));
    }
    return Promise.all(promises)
        .then(values => {
            console.timeEnd('randomClassAnswers');
            return values;
        });
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