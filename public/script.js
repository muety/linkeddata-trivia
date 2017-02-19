let btn = $('#mainButton');
let btnTextOriginal = btn.text();
let answerButtonsElem = $('#answerButtons');
let questionHeadingElem = $('#questionHeading');
let questionContainerElem = $('.questionContainer');
let alert = $('.alert');

btn.click(() => {
    btn.attr("disabled", true);
    btn.text('↺ Loading ...');
    alert.show();
    answerButtonsElem.empty();
    questionHeadingElem.empty();

    let answerButtons = [];
    $.getJSON('/api/random', data => {
        questionHeadingElem.html(data.q);
        $.each(data.alternativeAnswers, (index, a) => answerButtons.push($('<button type="button" class="btn btn-secondary answerButton wrongAnswer">' + a + '</button>')));
        answerButtons.push($('<button type="button" class="btn btn-secondary answerButton correctAnswer">' + data.correctAnswer + '</button>'));
        answerButtons = shuffle(answerButtons);
        $.each(answerButtons, (index, b) => answerButtonsElem.append(b));

        $('.wrongAnswer').click(() => alert('Sorry, that was wrong...'));
        $('.correctAnswer').click(() => alert('Yes, right!'));

        btn.attr("disabled", false);
        btn.text(btnTextOriginal);

        alert.hide();
        questionContainerElem.show();
    });
});

function shuffle(array) {
    var currentIndex = array.length,
        temporaryValue, randomIndex;
    while (0 !== currentIndex) {
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex -= 1;
        temporaryValue = array[currentIndex];
        array[currentIndex] = array[randomIndex];
        array[randomIndex] = temporaryValue;
    }
    return array;
}