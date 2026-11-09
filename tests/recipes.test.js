const test = require('node:test');
const assert = require('node:assert/strict');
const RC = require('../js/recipes.js');

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= (tol || 0.5), `${a} ≈ ${b}`);
const key = n => (RC.matchIngredient(n) || {}).key || null;

test('matches messy ingredient names to the right entry', () => {
  assert.equal(key('Finely chopped red onions'), 'onion');
  assert.equal(key('Chicken Stock'), 'chicken stock');        // not "chicken"
  assert.equal(key('Peanut Butter'), 'peanut butter');        // not "butter"
  assert.equal(key('Garlic Powder'), 'black pepper');         // the dried-spice entry, not fresh garlic
  assert.equal(key('Egg Noodles'), 'egg noodles');            // not "egg"
  assert.equal(key('Butter Beans'), 'kidney beans');          // beans, not butter
  assert.equal(key('Coconut Milk'), 'coconut milk');          // not milk
  assert.equal(key('Spaghetti'), 'pasta');
  assert.equal(key('Tomatoes'), 'tomatoes');
  assert.equal(key('Chopped Tomatoes'), 'chopped tomatoes');
  assert.equal(key('Bay Leaves'), 'bay leaf');
  assert.equal(key('Unobtainium'), null);
});

test('reads recipe measures', () => {
  assert.deepEqual(RC.parseMeasure('1 1/2 tbsp'), { qty: 1.5, unit: 'tbsp' });
  assert.deepEqual(RC.parseMeasure('200g'), { qty: 200, unit: 'g' });
  assert.deepEqual(RC.parseMeasure('½ tsp'), { qty: 0.5, unit: 'tsp' });
  assert.deepEqual(RC.parseMeasure('1½ cups'), { qty: 1.5, unit: 'cup' });
  assert.deepEqual(RC.parseMeasure('2-3 cloves'), { qty: 2.5, unit: 'clove' });
  assert.deepEqual(RC.parseMeasure('3'), { qty: 3, unit: null });
  assert.deepEqual(RC.parseMeasure('To taste'), { qty: 0, unit: null });
  assert.deepEqual(RC.parseMeasure('Pinch'), { qty: 1, unit: 'pinch' });
  assert.deepEqual(RC.parseMeasure('2 Lbs'), { qty: 2, unit: 'lb' });
  assert.deepEqual(RC.parseMeasure('4 fl oz'), { qty: 4, unit: 'floz' });
  assert.deepEqual(RC.parseMeasure(''), { qty: null, unit: null });
});

test('converts measures to grams using each ingredient', () => {
  const g = (name, measure) => RC.toGrams(RC.matchIngredient(name), measure);
  near(g('Garlic', '2 cloves'), 6);
  near(g('Olive Oil', '1 tbsp'), 13.8);
  near(g('Plain Flour', '1 cup'), 127.2);
  near(g('Eggs', '3'), 150);
  near(g('Onion', '1 large'), 143);
  near(g('Chopped Tomatoes', '1 can'), 400);
  near(g('Salt', 'to taste'), 0);
  near(g('Beef', '1 lb'), 453.6);
  near(g('Milk', '250ml'), 257.5);
  near(g('Butter', '1 stick'), 113);
});

// A realistic TheMealDB record
const BOLOGNESE = {
  idMeal: '52770', strMeal: 'Spaghetti Bolognese', strCategory: 'Beef', strArea: 'Italian', strMealThumb: 'https://x/img.jpg',
  strInstructions: 'Fry the onion. Add the mince…',
  strIngredient1: 'Olive Oil', strMeasure1: '1 tbsp', strIngredient2: 'Onion', strMeasure2: '1 chopped',
  strIngredient3: 'Garlic', strMeasure3: '2 cloves', strIngredient4: 'Minced Beef', strMeasure4: '500g',
  strIngredient5: 'Chopped Tomatoes', strMeasure5: '1 can', strIngredient6: 'Tomato Puree', strMeasure6: '2 tbsp',
  strIngredient7: 'Spaghetti', strMeasure7: '400g', strIngredient8: 'Parmesan', strMeasure8: 'To serve',
  strIngredient9: 'Salt', strMeasure9: 'Pinch', strIngredient10: 'Mystery Sauce', strMeasure10: '1 jar', strIngredient11: '',
};

test('estimates nutrition per serving and reports coverage', () => {
  const r = RC.fromMealDB(BOLOGNESE);
  assert.equal(r.ingredients.length, 10);
  const n = RC.nutrition(r, 4);
  // 1 tbsp oil 122 + onion 44 + garlic 9 + mince 1075 + tomatoes 84 + puree 26.5 + pasta 1484 ≈ 2845 kcal → ~711 a serving
  near(n.perServing.kcal, 711, 15);
  near(n.perServing.protein, 38.2, 1); // mince 93 g + pasta 52 g + veg ≈ 153 g protein ÷ 4
  assert.deepEqual(n.coverage.missing, ['Mystery Sauce']);   // "to serve" parmesan and pinch of salt are fine
  assert.equal(n.coverage.counted, 9);
  near(RC.nutrition(r, 6).perServing.kcal, n.perServing.kcal * 4 / 6, 1);
});

test('pantry matching is forgiving but not sloppy', () => {
  const pantry = ['chicken thighs', 'rice', 'onions', 'pasta'];
  assert.ok(RC.pantryHas(pantry, 'Red Onion'));
  assert.ok(RC.pantryHas(pantry, 'Basmati Rice'));
  assert.ok(RC.pantryHas(pantry, 'Spaghetti'));          // both are "pasta"
  assert.ok(RC.pantryHas(pantry, 'Chicken Thigh'));
  assert.ok(RC.pantryHas(pantry, 'Salt'));               // always assumed
  assert.ok(RC.pantryHas(pantry, 'Black Pepper'));
  assert.ok(!RC.pantryHas(pantry, 'Chicken Stock'));     // a stock isn't chicken thighs
  assert.ok(!RC.pantryHas(pantry, 'Garlic'));
  // a word inside another ingredient isn't the same thing
  assert.ok(!RC.pantryHas(['chicken'], 'Chicken Stock Cube'));
  assert.ok(!RC.pantryHas(['chicken'], 'Chicken Stock'));
  assert.ok(!RC.pantryHas(['rice'], 'Rice Vinegar'));
  assert.ok(!RC.pantryHas(['potatoes'], 'Sweet Potato'));
  assert.ok(!RC.pantryHas(['lemongrass'], 'Lemongrass Paste'));
  // but the same thing under another name, or a cut of the same meat, is
  assert.ok(RC.pantryHas(['chicken'], 'Chicken Breasts'));
  assert.ok(RC.pantryHas(['chicken thighs'], 'Chicken'));
  assert.ok(RC.pantryHas(['beef mince'], 'Minced Beef'));
  assert.ok(RC.pantryHas(['lemongrass'], 'Fresh Lemongrass'));
  assert.ok(!RC.pantryHas(['chicken'], 'Beef'));
  assert.ok(!RC.pantryHas(['chicken breast'], 'Chicken Thighs'));   // one cut isn't another
});

test('maps pantry items to TheMealDB ingredient names', () => {
  const list = ['Chicken', 'Chicken Breast', 'Chicken Thighs', 'Chicken Stock', 'Rice', 'Basmati Rice', 'Onions', 'Red Onions'];
  assert.deepEqual(RC.mealdbNamesFor('chicken thigh', list), ['Chicken Thighs']);
  assert.deepEqual(RC.mealdbNamesFor('onion', list), ['Onions']);
  assert.deepEqual(RC.mealdbNamesFor('rice', list), ['Rice']);
  assert.deepEqual(RC.mealdbNamesFor('beef mince', ['Minced Beef', 'Beef', 'Onion']), ['Minced Beef']);
});

test('shopping list adds up across recipes and flags what you have', () => {
  const list = RC.shoppingList([
    { name: 'Red Onions', grams: 110, recipe: 'Chilli' }, { name: 'Onion', grams: 220, recipe: 'Curry' },
    { name: 'Rice', grams: 300, recipe: 'Curry' }, { name: 'Water', grams: 500 }, { name: 'Coriander', grams: 10 },
  ], ['rice']);
  const onion = list.find(r => r.key === 'onion');
  assert.equal(onion.grams, 330);
  assert.deepEqual(onion.from.sort(), ['Chilli', 'Curry']);
  assert.equal(list.find(r => r.key === 'rice').have, true);
  assert.ok(!list.some(r => r.key === 'water'));
  assert.equal(list[list.length - 1].key, 'rice');      // things you have go last
});

test('finds recipes from what you have, best use of your ingredients first', async () => {
  const meals = {
    1: Object.assign({}, BOLOGNESE, { idMeal: '1', strMeal: 'Uses three' , strIngredient7: 'Spaghetti' }),
    2: { idMeal: '2', strMeal: 'Uses one', strIngredient1: 'Minced Beef', strMeasure1: '500g', strIngredient2: 'Lemongrass', strMeasure2: '1', strIngredient3: 'Galangal', strMeasure3: '1', strIngredient4: 'Salt', strMeasure4: 'pinch' },
  };
  const real = global.fetch;
  global.fetch = async url => {
    const u = String(url);
    const json = body => ({ ok: true, status: 200, json: async () => body });
    if (u.includes('list.php?i=list')) return json({ meals: [{ strIngredient: 'Minced Beef' }, { strIngredient: 'Onion' }, { strIngredient: 'Spaghetti' }] });
    if (u.includes('filter.php?i=Minced_Beef')) return json({ meals: [{ idMeal: '1' }, { idMeal: '2' }] });
    if (u.includes('filter.php?i=Onion')) return json({ meals: [{ idMeal: '1' }] });
    if (u.includes('filter.php?i=Spaghetti')) return json({ meals: [{ idMeal: '1' }] });
    const id = (u.match(/lookup\.php\?i=(\d+)/) || [])[1];
    if (id) return json({ meals: [meals[id]] });
    return json({ meals: null });
  };
  try {
    const res = await RC.findByPantry(['beef mince', 'onion', 'spaghetti']);
    assert.deepEqual(res.map(r => r.name), ['Uses three', 'Uses one']);
    assert.equal(res[0].used.length, 3);
    assert.deepEqual(res[1].used, ['beef mince']);          // salt etc. never count as "using" your items
    assert.ok(res[1].need.includes('Lemongrass'));
  } finally { global.fetch = real; }
});
