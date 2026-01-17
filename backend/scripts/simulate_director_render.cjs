const fs = require('fs');
const path = require('path');
const nunjucks = require('nunjucks');

const templatePath = path.join(__dirname, '..', 'src', 'prompts', 'director.njk');
const template = fs.readFileSync(templatePath, 'utf8');

function renderWith(activeCharacterNames) {
  const ctx = {
    formattedLore: null,
    history: ['Alice: Hello', 'Bob: Hi there'],
    plotArc: 'Opening',
    worldState: { time: 'noon' },
    userInput: 'Talk to Alice and Bob',
    activeCharacterNames: activeCharacterNames
  };
  return nunjucks.renderString(template, ctx);
}

console.log('--- Render with unsafe names (includes Undefined) ---');
console.log(renderWith('Alice, undefined, Bob'));

console.log('\n--- Render with safe names ---');
console.log(renderWith('Alice, Bob'));
