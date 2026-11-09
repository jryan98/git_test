/*
 * recipes.js — web recipes (TheMealDB) with estimated nutrition, pantry matching and shopping lists.
 *
 * TheMealDB gives ingredients as free text ("2 cloves garlic", "200g chicken") but no nutrition, so each
 * line is matched to a table of common cooking ingredients (per 100 g, UK-style carbs without fibre,
 * approximate USDA values) and its measure converted to grams. Pure functions + a small API client;
 * works in the browser (window.Recipes) and Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Recipes = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // [aliases (first = name), kcal, protein, carbs, sugar, fat, satFat, fibre, salt, extras]
  // extras: d = density g/ml (default 1), p = g per piece, c = g per clove, s = g per slice, can, h = handful,
  //         b = bunch, st = stick
  const SPICE = [300, 12, 30, 3, 10, 1, 30, 0.1, { d: 0.5, p: 2 }];
  const HERB = [36, 3, 3, 0.9, 0.8, 0.1, 3.3, 0.1, { d: 0.1, p: 1, h: 10, b: 25 }];
  const ROWS = [
    // meat & fish (raw)
    [['chicken breast', 'chicken breasts', 'chicken fillet'], 120, 22.5, 0, 0, 2.6, 0.6, 0, 0.12, { p: 170 , f: 'chicken' }],
    [['chicken thigh', 'chicken thighs', 'chicken legs', 'chicken drumsticks'], 121, 19.7, 0, 0, 4.1, 1, 0, 0.2, { p: 100 , f: 'chicken' }],
    [['chicken', 'whole chicken'], 215, 18.6, 0, 0, 15, 4.3, 0, 0.18, { p: 1500 , f: 'chicken' }],
    [['chicken stock', 'chicken broth', 'beef stock', 'vegetable stock', 'stock', 'beef broth', 'vegetable broth', 'fish stock'], 6, 0.6, 0.4, 0.3, 0.2, 0.1, 0, 0.9, {}],
    [['stock cube', 'chicken stock cube', 'beef stock cube', 'vegetable stock cube', 'bouillon'], 260, 10, 20, 5, 15, 7, 0, 50, { p: 10 }],
    [['minced beef', 'beef mince', 'ground beef', 'mince'], 215, 18.6, 0, 0, 15, 6, 0, 0.17, { f: 'beef' }],
    [['beef', 'stewing beef', 'braising steak', 'steak', 'sirloin', 'beef brisket', 'beef fillet'], 158, 21, 0, 0, 8, 3.2, 0, 0.15, { p: 225 , f: 'beef' }],
    [['lamb', 'lamb mince', 'minced lamb', 'lamb shoulder', 'lamb leg', 'lamb chops'], 282, 16.6, 0, 0, 23.4, 10.2, 0, 0.15, { p: 150 }],
    [['pork', 'pork loin', 'pork chops', 'pork shoulder', 'pork belly', 'pork tenderloin'], 143, 21, 0, 0, 6, 2, 0, 0.15, { p: 150 , f: 'pork' }],
    [['pork mince', 'minced pork', 'ground pork'], 263, 17, 0, 0, 21, 7.9, 0, 0.15, { f: 'pork' }],
    [['bacon', 'streaky bacon', 'pancetta', 'lardons'], 417, 13, 1.4, 0, 40, 13, 0, 2.0, { p: 25, s: 25 }],
    [['sausages', 'sausage', 'pork sausages'], 300, 12, 9, 1.5, 24, 8.5, 1, 1.8, { p: 57 }],
    [['chorizo'], 455, 24, 2, 1, 38, 14, 0, 3.0, { p: 200, s: 6 }],
    [['ham', 'prosciutto', 'parma ham'], 145, 21, 1, 1, 6, 2, 0, 2.2, { s: 25, p: 25 }],
    [['salmon', 'salmon fillet', 'salmon fillets', 'smoked salmon'], 208, 20, 0, 0, 13, 3.1, 0, 0.15, { p: 130 }],
    [['cod', 'haddock', 'white fish', 'hake', 'pollock', 'tilapia', 'sea bass', 'fish fillets'], 82, 18, 0, 0, 0.7, 0.1, 0, 0.15, { p: 150 }],
    [['tuna', 'tinned tuna', 'canned tuna'], 116, 25.5, 0, 0, 0.8, 0.2, 0, 0.8, { can: 112 }],
    [['prawns', 'king prawns', 'shrimp', 'raw king prawns'], 85, 20, 0.2, 0, 0.5, 0.1, 0, 0.7, { p: 12 }],
    [['egg', 'eggs', 'free range eggs'], 143, 12.6, 0.7, 0.4, 9.5, 3.1, 0, 0.36, { p: 50 }],
    [['egg yolk', 'egg yolks'], 322, 16, 3.6, 0.6, 26.5, 9.6, 0, 0.12, { p: 17 }],
    [['egg white', 'egg whites'], 52, 11, 0.7, 0.7, 0.2, 0, 0, 0.42, { p: 33 }],
    [['tofu', 'firm tofu'], 144, 17.3, 0.5, 0.6, 8.7, 1.3, 2.3, 0.03, { p: 400 }],
    // dairy
    [['milk', 'whole milk', 'semi-skimmed milk', 'skimmed milk'], 64, 3.3, 4.7, 4.7, 3.6, 2.3, 0, 0.1, { d: 1.03 }],
    [['butter', 'unsalted butter', 'salted butter'], 717, 0.9, 0.1, 0.1, 81, 51, 0, 1.5, { d: 0.96, st: 113 }],
    [['double cream', 'heavy cream', 'whipping cream'], 445, 1.7, 2.7, 2.7, 48, 30, 0, 0.07, {}],
    [['single cream', 'cream', 'light cream'], 193, 2.6, 4.1, 4.1, 19, 12, 0, 0.1, {}],
    [['sour cream', 'creme fraiche', 'crème fraîche'], 198, 2.4, 4.6, 3.4, 19, 12, 0, 0.08, {}],
    [['greek yogurt', 'greek yoghurt', 'yogurt', 'yoghurt', 'natural yoghurt', 'plain yogurt'], 97, 9, 4, 4, 5, 3.3, 0, 0.09, { d: 1.05 }],
    [['cheddar cheese', 'cheddar', 'cheese', 'grated cheese', 'red leicester', 'gruyere', 'gruyère'], 403, 25, 1.3, 0.5, 33, 21, 0, 1.8, { d: 0.45, s: 25 }],
    [['parmesan', 'parmesan cheese', 'parmigiano reggiano', 'pecorino'], 431, 38, 4, 0.9, 29, 19, 0, 3.9, { d: 0.4 }],
    [['mozzarella', 'mozzarella cheese', 'mozzarella balls'], 280, 22, 2.2, 1, 21, 13, 0, 1.2, { p: 125, d: 0.45 }],
    [['feta', 'feta cheese', 'goats cheese', 'goat cheese'], 264, 14, 4, 4, 21, 15, 0, 2.8, { d: 0.5 }],
    [['cream cheese', 'mascarpone', 'ricotta'], 342, 6, 4, 3, 34, 20, 0, 0.8, {}],
    // grains & starches (dry unless stated)
    [['plain flour', 'flour', 'all purpose flour', 'all-purpose flour', 'bread flour', 'strong white bread flour', 'wholemeal flour'], 364, 10, 73.6, 0.3, 1, 0.2, 2.7, 0, { d: 0.53 }],
    [['self-raising flour', 'self raising flour'], 354, 9.9, 74, 0.2, 1, 0.2, 2.7, 0.9, { d: 0.53 }],
    [['cornflour', 'cornstarch', 'corn starch'], 381, 0.3, 90.4, 0, 0.1, 0, 0.9, 0.02, { d: 0.6 }],
    [['bread', 'white bread', 'sourdough', 'baguette', 'ciabatta', 'bread rolls', 'pitta bread', 'naan bread'], 265, 9, 46, 5, 3.2, 0.7, 2.7, 1.2, { s: 36, p: 60 }],
    [['breadcrumbs', 'panko', 'panko breadcrumbs'], 395, 13, 68, 6, 5, 1, 4.5, 1.8, { d: 0.45 }],
    [['rice', 'white rice', 'basmati rice', 'long grain rice', 'jasmine rice', 'arborio rice', 'risotto rice', 'brown rice', 'paella rice'], 360, 6.6, 79, 0.1, 0.6, 0.2, 1.3, 0, { d: 0.85 }],
    [['pasta', 'spaghetti', 'penne', 'macaroni', 'fusilli', 'linguine', 'tagliatelle', 'lasagne sheets', 'lasagna sheets', 'rigatoni', 'farfalle', 'fettuccine'], 371, 13, 72, 2.7, 1.5, 0.3, 3.2, 0, { d: 0.45 }],
    [['egg noodles', 'noodles', 'udon noodles', 'ramen noodles'], 384, 14, 71, 1, 4.4, 1, 3.3, 0.05, { p: 60 }],
    [['rice noodles', 'vermicelli', 'rice vermicelli'], 364, 6, 80, 0, 0.6, 0.2, 1.6, 0.05, {}],
    [['oats', 'rolled oats', 'porridge oats', 'oatmeal'], 379, 13.2, 57.6, 1, 6.5, 1.1, 10.1, 0, { d: 0.4 }],
    [['potatoes', 'potato', 'new potatoes', 'baby potatoes', 'maris piper potatoes', 'floury potatoes'], 77, 2, 15.4, 0.8, 0.1, 0, 2.2, 0.01, { p: 170 }],
    [['sweet potatoes', 'sweet potato'], 86, 1.6, 17.1, 4.2, 0.1, 0, 3, 0.14, { p: 130 }],
    [['couscous'], 376, 12.8, 72.4, 0, 0.6, 0.1, 5, 0.02, { d: 0.7 }],
    [['quinoa'], 368, 14, 57, 0, 6, 0.7, 7, 0.01, { d: 0.75 }],
    [['tortillas', 'tortilla', 'flour tortillas', 'tortilla wraps', 'wraps'], 310, 8, 48, 3, 8, 3, 3.5, 1.2, { p: 60 }],
    [['puff pastry', 'shortcrust pastry', 'pastry', 'filo pastry'], 551, 7.3, 45, 1, 38, 20, 1.5, 0.9, {}],
    // vegetables (raw)
    [['onion', 'onions', 'red onion', 'red onions', 'white onion', 'brown onion', 'yellow onion'], 40, 1.1, 7.6, 4.2, 0.1, 0, 1.7, 0.01, { p: 110 }],
    [['spring onions', 'spring onion', 'scallions', 'green onions'], 32, 1.8, 4.7, 2.3, 0.2, 0, 2.6, 0.04, { p: 15 }],
    [['shallots', 'shallot'], 72, 2.5, 13.6, 7.9, 0.1, 0, 3.2, 0.03, { p: 25 }],
    [['garlic', 'garlic cloves', 'garlic clove'], 149, 6.4, 31, 1, 0.5, 0.1, 2.1, 0.04, { p: 3, c: 3 }],
    [['ginger', 'fresh ginger', 'root ginger'], 80, 1.8, 15.8, 1.7, 0.8, 0.2, 2, 0.03, { p: 15 }],
    [['carrots', 'carrot'], 41, 0.9, 6.8, 4.7, 0.2, 0, 2.8, 0.17, { p: 61 }],
    [['celery', 'celery sticks', 'celery stalks'], 16, 0.7, 1.4, 1.3, 0.2, 0, 1.6, 0.2, { p: 40, st: 40 }],
    [['tomatoes', 'tomato', 'cherry tomatoes', 'plum tomatoes', 'vine tomatoes'], 18, 0.9, 2.7, 2.6, 0.2, 0, 1.2, 0.01, { p: 123 }],
    [['chopped tomatoes', 'tinned tomatoes', 'canned tomatoes', 'tinned chopped tomatoes', 'crushed tomatoes'], 21, 1.2, 3.2, 3, 0.1, 0, 1, 0.03, { can: 400 }],
    [['tomato puree', 'tomato purée', 'tomato paste'], 82, 4.3, 14.9, 12, 0.5, 0.1, 4.1, 0.1, { d: 1.1 }],
    [['passata', 'tomato sauce', 'marinara sauce'], 24, 1.3, 4.5, 3.5, 0.1, 0, 1, 0.1, { d: 1.03, can: 500 }],
    [['red pepper', 'green pepper', 'yellow pepper', 'peppers', 'bell pepper', 'bell peppers', 'red peppers', 'capsicum'], 31, 1, 4, 4.2, 0.3, 0, 2.1, 0.01, { p: 120 }],
    [['chilli', 'chillies', 'red chilli', 'green chilli', 'chili', 'chilies', 'jalapeno', 'jalapeño', 'scotch bonnet'], 40, 1.9, 7.3, 5.1, 0.4, 0, 1.5, 0.02, { p: 15 }],
    [['mushrooms', 'mushroom', 'button mushrooms', 'chestnut mushrooms', 'portobello mushrooms', 'shiitake mushrooms'], 22, 3.1, 2.3, 2, 0.3, 0, 1, 0.01, { p: 18 }],
    [['spinach', 'baby spinach', 'kale'], 23, 2.9, 1.4, 0.4, 0.4, 0.1, 2.2, 0.2, { d: 0.13, h: 30 }],
    [['broccoli', 'tenderstem broccoli'], 34, 2.8, 4, 1.7, 0.4, 0, 2.6, 0.08, { p: 300 }],
    [['cauliflower'], 25, 1.9, 3, 1.9, 0.3, 0.1, 2, 0.08, { p: 600 }],
    [['courgette', 'courgettes', 'zucchini'], 17, 1.2, 2.1, 2.5, 0.3, 0.1, 1, 0.02, { p: 200 }],
    [['aubergine', 'aubergines', 'eggplant'], 25, 1, 2.9, 3.5, 0.2, 0, 3, 0.01, { p: 300 }],
    [['peas', 'frozen peas', 'petit pois'], 81, 5.4, 9.8, 5.7, 0.4, 0.1, 5.1, 0.01, { d: 0.6 }],
    [['sweetcorn', 'corn', 'sweet corn'], 86, 3.3, 16.9, 6.3, 1.4, 0.3, 2, 0.04, { d: 0.65, can: 200 }],
    [['green beans', 'runner beans', 'french beans', 'mangetout', 'sugar snap peas'], 31, 1.8, 4.3, 3.3, 0.2, 0, 2.7, 0.01, { h: 40 }],
    [['cabbage', 'red cabbage', 'savoy cabbage', 'pak choi', 'bok choy'], 25, 1.3, 3.3, 3.2, 0.1, 0, 2.5, 0.04, { p: 900 }],
    [['lettuce', 'rocket', 'salad leaves', 'iceberg lettuce', 'romaine lettuce', 'arugula'], 15, 1.4, 1.6, 0.8, 0.2, 0, 1.3, 0.07, { p: 300, h: 20 }],
    [['cucumber'], 15, 0.7, 3.1, 1.7, 0.1, 0, 0.5, 0, { p: 300 }],
    [['leek', 'leeks'], 61, 1.5, 12.4, 3.9, 0.3, 0, 1.8, 0.05, { p: 150 }],
    [['avocado', 'avocados'], 160, 2, 1.8, 0.7, 14.7, 2.1, 6.7, 0.02, { p: 150 }],
    [['butternut squash', 'squash', 'pumpkin'], 45, 1, 9.7, 2.2, 0.1, 0, 2, 0.01, { p: 1000 }],
    [['beetroot', 'beets'], 43, 1.6, 7, 6.8, 0.2, 0, 2.8, 0.2, { p: 80 }],
    [['olives', 'black olives', 'green olives', 'kalamata olives'], 145, 1, 0.5, 0, 15, 2, 3.3, 3.9, { p: 4 }],
    // fruit
    [['lemon', 'lemons'], 29, 1.1, 6.5, 2.5, 0.3, 0, 2.8, 0, { p: 85 }],
    [['lemon juice', 'lime juice'], 22, 0.4, 6.6, 2.5, 0.2, 0, 0.3, 0, {}],
    [['lime', 'limes'], 30, 0.7, 7.7, 1.7, 0.2, 0, 2.8, 0, { p: 67 }],
    [['apple', 'apples', 'bramley apples', 'cooking apples'], 52, 0.3, 11.4, 10.4, 0.2, 0, 2.4, 0, { p: 182 }],
    [['banana', 'bananas'], 89, 1.1, 20.2, 12.2, 0.3, 0.1, 2.6, 0, { p: 118 }],
    [['orange', 'oranges'], 47, 0.9, 9.4, 9.4, 0.1, 0, 2.4, 0, { p: 131 }],
    [['strawberries', 'raspberries', 'blueberries', 'berries', 'mixed berries', 'blackberries'], 45, 0.8, 8, 7, 0.3, 0, 2.2, 0, { d: 0.6 }],
    [['raisins', 'sultanas', 'currants', 'dried fruit'], 299, 3.1, 76, 59, 0.5, 0.1, 3.7, 0.03, { d: 0.65 }],
    [['mango', 'mangoes'], 60, 0.8, 13.4, 13.7, 0.4, 0.1, 1.6, 0, { p: 200 }],
    [['coconut milk', 'coconut cream'], 197, 2, 2.8, 2.8, 21, 18.9, 0, 0.04, { can: 400 }],
    // pulses, nuts & seeds
    [['chickpeas', 'chick peas', 'garbanzo beans'], 139, 7, 18, 0.5, 2.6, 0.3, 7, 0.3, { can: 240, d: 0.65 }],
    [['kidney beans', 'black beans', 'cannellini beans', 'butter beans', 'haricot beans', 'beans', 'pinto beans', 'borlotti beans'], 127, 8.7, 16, 0.3, 0.5, 0.1, 6.4, 0.3, { can: 240, d: 0.7 }],
    [['baked beans'], 78, 4.7, 10.5, 4.7, 0.2, 0, 3.7, 0.6, { can: 415 }],
    [['lentils', 'red lentils', 'green lentils', 'puy lentils', 'brown lentils'], 352, 24, 48, 2, 1.1, 0.2, 11, 0.01, { d: 0.85 }],
    [['peanut butter'], 588, 25, 14, 9, 50, 10, 6, 1.1, { d: 1.08 }],
    [['almonds', 'ground almonds', 'flaked almonds'], 579, 21, 9.1, 4.4, 50, 3.8, 12.5, 0, { d: 0.45 }],
    [['peanuts'], 585, 24, 13, 4, 50, 7, 8, 0.02, { d: 0.6 }],
    [['cashew nuts', 'cashews'], 553, 18, 30, 6, 44, 8, 3.3, 0.03, { d: 0.55 }],
    [['walnuts', 'pecans', 'pecan nuts', 'hazelnuts'], 654, 15, 7, 2.6, 65, 6, 6.7, 0, { d: 0.45 }],
    [['sesame seeds', 'pumpkin seeds', 'sunflower seeds', 'pine nuts'], 573, 18, 12, 0.3, 50, 7, 11.8, 0.03, { d: 0.6 }],
    // oils, sugar, sauces & condiments
    [['olive oil', 'extra virgin olive oil', 'vegetable oil', 'sunflower oil', 'oil', 'rapeseed oil', 'groundnut oil', 'sesame oil', 'coconut oil'], 884, 0, 0, 0, 100, 14, 0, 0, { d: 0.92 }],
    [['sugar', 'caster sugar', 'granulated sugar', 'white sugar'], 400, 0, 100, 100, 0, 0, 0, 0, { d: 0.85 }],
    [['brown sugar', 'light brown sugar', 'dark brown sugar', 'muscovado sugar', 'demerara sugar'], 380, 0.1, 98, 97, 0, 0, 0, 0.07, { d: 0.9 }],
    [['icing sugar', 'powdered sugar'], 389, 0, 99.8, 97.8, 0, 0, 0, 0, { d: 0.56 }],
    [['honey'], 304, 0.3, 82, 82, 0, 0, 0.2, 0, { d: 1.42 }],
    [['maple syrup', 'golden syrup', 'agave syrup'], 260, 0, 67, 60, 0.1, 0, 0, 0.02, { d: 1.32 }],
    [['soy sauce', 'soya sauce', 'light soy sauce', 'dark soy sauce', 'tamari'], 53, 8, 4.9, 0.4, 0.6, 0.1, 0.8, 14.5, { d: 1.15 }],
    [['worcestershire sauce'], 78, 0, 19, 10, 0, 0, 0, 2.5, { d: 1.1 }],
    [['fish sauce'], 35, 5, 3.6, 3.6, 0, 0, 0, 23, { d: 1.2 }],
    [['vinegar', 'red wine vinegar', 'white wine vinegar', 'cider vinegar', 'balsamic vinegar', 'rice vinegar'], 21, 0, 0.9, 0.4, 0, 0, 0, 0, {}],
    [['mustard', 'dijon mustard', 'wholegrain mustard', 'english mustard'], 66, 4.4, 5.8, 1, 4, 0.2, 3.3, 2.8, { d: 1.05 }],
    [['mayonnaise', 'mayo'], 680, 1, 0.6, 0.6, 75, 11, 0, 1.5, { d: 0.95 }],
    [['ketchup', 'tomato ketchup'], 112, 1, 25, 22, 0.1, 0, 0.3, 2.3, { d: 1.15 }],
    [['pesto', 'basil pesto'], 450, 5, 6, 4, 45, 7, 2, 2.5, {}],
    [['curry paste', 'thai red curry paste', 'thai green curry paste', 'red curry paste', 'green curry paste'], 110, 2, 12, 5, 6, 0.6, 3, 7, {}],
    [['red wine', 'white wine', 'wine', 'dry white wine'], 85, 0.1, 2.6, 0.6, 0, 0, 0, 0, {}],
    [['beer', 'ale', 'stout'], 43, 0.5, 3.6, 0, 0, 0, 0, 0, {}],
    [['dark chocolate', 'chocolate', 'milk chocolate', 'chocolate chips'], 546, 6.5, 50, 45, 32, 19, 7, 0.1, { d: 0.6 }],
    [['cocoa powder', 'cocoa', 'cacao'], 228, 19.6, 47, 1.8, 13.7, 8, 33, 0.05, { d: 0.5 }],
    [['vanilla extract', 'vanilla essence', 'vanilla'], 288, 0.1, 12.7, 12.7, 0.1, 0, 0, 0.02, { d: 0.88 }],
    [['baking powder'], 53, 0, 28, 0, 0, 0, 0.2, 27, { d: 0.9 }],
    [['bicarbonate of soda', 'baking soda', 'bicarb'], 0, 0, 0, 0, 0, 0, 0, 68, { d: 1.1 }],
    [['yeast', 'dried yeast', 'fast action yeast'], 325, 40, 32, 0, 7.6, 1, 27, 0.13, { d: 0.6, p: 7 }],
    [['salt', 'sea salt', 'table salt', 'kosher salt', 'salt and pepper'], 0, 0, 0, 0, 0, 0, 0, 100, { d: 1.2 }],
    [['water', 'cold water', 'warm water', 'boiling water', 'ice'], 0, 0, 0, 0, 0, 0, 0, 0, {}],
    // herbs & spices
    [['parsley', 'coriander', 'cilantro', 'basil', 'mint', 'dill', 'chives', 'thyme', 'rosemary', 'sage', 'tarragon', 'fresh herbs', 'coriander leaves', 'basil leaves', 'mint leaves', 'flat leaf parsley'], ...HERB],
    [['bay leaf', 'bay leaves', 'kaffir lime leaves', 'curry leaves'], ...HERB],
    [['black pepper', 'pepper', 'ground black pepper', 'white pepper', 'peppercorns', 'cumin', 'ground cumin', 'cumin seeds', 'paprika', 'smoked paprika',
      'chilli powder', 'chili powder', 'cayenne pepper', 'turmeric', 'ground turmeric', 'cinnamon', 'ground cinnamon', 'cinnamon stick', 'ground coriander', 'coriander seeds',
      'garam masala', 'curry powder', 'mixed spice', 'nutmeg', 'ground ginger', 'chilli flakes', 'red pepper flakes', 'oregano', 'dried oregano', 'mixed herbs', 'dried herbs',
      'italian seasoning', 'cloves', 'cardamom', 'cardamom pods', 'fennel seeds', 'mustard seeds', 'star anise', 'allspice', 'saffron', 'five spice', 'chinese five spice',
      'garlic powder', 'onion powder', 'ras el hanout', 'za\'atar', 'sumac', 'cajun seasoning', 'jerk seasoning', 'fenugreek'], ...SPICE],
  ];

  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

  const INGREDIENTS = ROWS.map(r => {
    const x = r[9] || {};
    return {
      key: norm(r[0][0]), name: r[0][0], aliases: r[0].map(norm),
      per100: { kcal: r[1], protein: r[2], carbs: r[3], sugar: r[4], fat: r[5], satFat: r[6], fiber: r[7], salt: r[8] },
      family: x.f || null, density: x.d || 1, piece: x.p, clove: x.c, slice: x.s, can: x.can, handful: x.h, bunch: x.b, stick: x.st,
    };
  });
  // longest aliases first, so "chicken stock" wins over "chicken" and "peanut butter" over "butter"
  const ALIASES = [];
  INGREDIENTS.forEach(e => e.aliases.forEach(a => ALIASES.push({ a, e })));
  ALIASES.sort((x, y) => y.a.length - x.a.length);
  const reCache = new Map();
  const wordRe = a => {
    if (!reCache.has(a)) reCache.set(a, new RegExp('(^| )' + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(s|es)?( |$)'));
    return reCache.get(a);
  };

  /** Match free-text ingredient ("Finely chopped red onions") to a table entry, or null. */
  function matchIngredient(name) {
    const n = norm(name);
    if (!n) return null;
    for (const { a, e } of ALIASES) if (n === a) return e;
    for (const { a, e } of ALIASES) if (wordRe(a).test(n)) return e;
    return null;
  }

  // ---------- measures ----------
  const UNICODE_FRACTIONS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };
  const UNIT_WORDS = [
    [/^(g|gr|grams?|gm|gms)$/, 'g'], [/^(kg|kgs|kilos?|kilograms?)$/, 'kg'], [/^mg$/, 'mg'],
    [/^(ml|mls|millilitres?|milliliters?)$/, 'ml'], [/^(l|ltr|litres?|liters?)$/, 'l'], [/^cl$/, 'cl'], [/^dl$/, 'dl'],
    [/^(tsp|tsps|teaspoons?|t)$/, 'tsp'], [/^(tbsp|tbsps|tbs|tbls|tbl|tblsp|tablespoons?|tbsps)$/, 'tbsp'], [/^(dsp|dessertspoons?)$/, 'dsp'],
    [/^cups?$/, 'cup'], [/^(oz|ounces?)$/, 'oz'], [/^(lb|lbs|pounds?)$/, 'lb'], [/^(floz)$/, 'floz'],
    [/^(pinch|pinches|dash|dashes|sprinkle|sprinkling|splash)$/, 'pinch'], [/^cloves?$/, 'clove'], [/^slices?$/, 'slice'],
    [/^(cans?|tins?|jars?)$/, 'can'], [/^handfuls?$/, 'handful'], [/^bunch(es)?$/, 'bunch'], [/^sprigs?$/, 'sprig'],
    [/^sticks?$/, 'stick'], [/^knobs?$/, 'knob'], [/^large$/, 'large'], [/^small$/, 'small'],
    [/^(medium|whole|pieces?|heads?|fillets?|breasts?|thighs?|leg|legs|rashers?|stalks?)$/, 'piece'],
  ];
  /** "1 1/2 tbsp" → { qty: 1.5, unit: 'tbsp' }; "to taste" → { qty: 0 }; "" → { qty: null } */
  function parseMeasure(measure) {
    let s = String(measure || '').toLowerCase().trim();
    s = s.replace(/(\d)?\s*([½¼¾⅓⅔⅛])/g, (all, d, f) => ' ' + ((d ? +d : 0) + UNICODE_FRACTIONS[f]) + ' ').trim();
    s = s.replace(/fl\.?\s*oz/g, 'floz');
    let qty = null, m;
    if ((m = s.match(/^(\d+)\s+(\d+)\/(\d+)/))) { qty = +m[1] + m[2] / m[3]; s = s.slice(m[0].length); }
    else if ((m = s.match(/^(\d+(?:[.,]\d+)?)\s*(?:-|–|to)\s*(\d+(?:[.,]\d+)?)/))) { qty = (parseFloat(m[1].replace(',', '.')) + parseFloat(m[2].replace(',', '.'))) / 2; s = s.slice(m[0].length); }
    else if ((m = s.match(/^(\d+)\/(\d+)/))) { qty = m[1] / m[2]; s = s.slice(m[0].length); }
    else if ((m = s.match(/^(\d+(?:[.,]\d+)?)/))) { qty = parseFloat(m[1].replace(',', '.')); s = s.slice(m[0].length); }
    const word = (s.trim().match(/^[a-z]+/) || [''])[0];
    const hit = UNIT_WORDS.find(([re]) => re.test(word));
    let unit = hit ? hit[1] : null;
    if (qty == null) {
      if (unit === 'pinch') qty = 1;
      else if (/taste|garnish|serve|drizzle|dusting|optional|greas/.test(s)) qty = 0;
      else if (unit) qty = 1; // "Bunch", "Handful"
    }
    return { qty, unit };
  }

  /** Grams for an ingredient line, using the matched entry's density and piece sizes. */
  function toGrams(entry, measure) {
    const { qty, unit } = parseMeasure(measure);
    if (!qty) return 0;
    const e = entry || {};
    const d = e.density || 1, piece = e.piece || 50;
    switch (unit) {
      case 'g': return qty;
      case 'kg': return qty * 1000;
      case 'mg': return qty / 1000;
      case 'ml': return qty * d;
      case 'l': return qty * 1000 * d;
      case 'cl': return qty * 10 * d;
      case 'dl': return qty * 100 * d;
      case 'tsp': return qty * 5 * d;
      case 'tbsp': return qty * 15 * d;
      case 'dsp': return qty * 10 * d;
      case 'cup': return qty * 240 * d;          // TheMealDB recipes mostly use US cups
      case 'floz': return qty * 29.57 * d;
      case 'oz': return qty * 28.35;
      case 'lb': return qty * 453.6;
      case 'pinch': return qty * 0.4;
      case 'clove': return qty * (e.clove || 3);
      case 'slice': return qty * (e.slice || 30);
      case 'can': return qty * (e.can || 400);
      case 'handful': return qty * (e.handful || 30);
      case 'bunch': return qty * (e.bunch || 25);
      case 'sprig': return qty * 1;
      case 'stick': return qty * (e.stick || piece);
      case 'knob': return qty * 15;
      case 'large': return qty * piece * 1.3;
      case 'small': return qty * piece * 0.7;
      default: return qty * piece;              // "2 onions", "3 medium eggs"
    }
  }

  // ---------- TheMealDB ----------
  const MEALDB = 'https://www.themealdb.com/api/json/v1/1';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function getJSON(url, signal) {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    if (signal) { if (signal.aborted) ctrl.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      for (let i = 0; ; i++) {
        try {
          const res = await fetch(url, { signal: ctrl.signal });
          if (!res.ok) throw Object.assign(new Error('The recipe site returned an error (' + res.status + ')'), { status: res.status });
          return await res.json();
        } catch (err) {
          if (ctrl.signal.aborted) throw signal && signal.aborted ? err : Object.assign(new Error('The recipe site took too long to respond'), { status: 'timeout' });
          const retry = err instanceof TypeError || (err.status >= 500);
          if (!retry || i >= 1) throw err instanceof TypeError ? Object.assign(new Error("Couldn't reach the recipe site — check your connection"), { status: 'network' }) : err;
          await sleep(700);
        }
      }
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }
  const CATEGORIES = ['Breakfast', 'Chicken', 'Beef', 'Pork', 'Lamb', 'Seafood', 'Pasta', 'Vegetarian', 'Vegan', 'Side', 'Starter', 'Dessert', 'Miscellaneous', 'Goat'];

  async function searchByName(q, signal) { return ((await getJSON(MEALDB + '/search.php?s=' + encodeURIComponent(q), signal)).meals || []); }
  async function byCategory(cat, signal) { return ((await getJSON(MEALDB + '/filter.php?c=' + encodeURIComponent(cat), signal)).meals || []); }
  async function byIngredient(name, signal) { return ((await getJSON(MEALDB + '/filter.php?i=' + encodeURIComponent(name.trim().replace(/\s+/g, '_')), signal)).meals || []); }
  const lookupCache = new Map();
  async function lookup(id, signal) {
    if (lookupCache.has(id)) return lookupCache.get(id);
    const meal = ((await getJSON(MEALDB + '/lookup.php?i=' + encodeURIComponent(id), signal)).meals || [])[0] || null;
    if (meal) lookupCache.set(id, meal);
    return meal;
  }
  let ingredientList = null;
  async function allIngredients(signal) {
    if (!ingredientList) ingredientList = ((await getJSON(MEALDB + '/list.php?i=list', signal)).meals || []).map(m => m.strIngredient).filter(Boolean);
    return ingredientList;
  }
  /** Look up full details for several ids, a few at a time. */
  async function lookupMany(ids, signal, limit) {
    const out = [];
    let i = 0;
    const worker = async () => { while (i < ids.length) { const id = ids[i++]; try { const m = await lookup(id, signal); if (m) out.push(m); } catch (e) { if (signal && signal.aborted) throw e; } } };
    await Promise.all(Array.from({ length: Math.min(limit || 4, ids.length) }, worker));
    const order = new Map(ids.map((id, k) => [String(id), k]));
    return out.sort((a, b) => order.get(String(a.idMeal)) - order.get(String(b.idMeal)));
  }

  /** Only plain web links from outside data — never javascript: or data: URLs. */
  const safeUrl = u => /^https?:\/\/[^\s"'<>]+$/i.test(String(u || '').trim()) ? String(u).trim() : '';

  /** TheMealDB meal → our recipe shape with estimated grams and nutrition per ingredient. */
  function fromMealDB(meal) {
    const ingredients = [];
    for (let i = 1; i <= 20; i++) {
      const name = (meal['strIngredient' + i] || '').trim();
      if (!name) continue;
      const measure = (meal['strMeasure' + i] || '').trim();
      const entry = matchIngredient(name);
      const grams = Math.round(toGrams(entry, measure) * 10) / 10;
      ingredients.push({ name, measure, entry, grams });
    }
    return {
      id: String(meal.idMeal), name: (meal.strMeal || '').trim(), image: safeUrl(meal.strMealThumb), category: meal.strCategory || '',
      area: meal.strArea || '', instructions: (meal.strInstructions || '').trim(), source: safeUrl(meal.strSource), youtube: safeUrl(meal.strYoutube),
      ingredients,
    };
  }

  const NUTRIENTS = ['kcal', 'protein', 'carbs', 'sugar', 'fat', 'satFat', 'fiber', 'salt'];
  const NEGLIGIBLE = new Set(['salt', 'water']);
  /**
   * Nutrition per serving and how much of the recipe it covers.
   * coverage.missing: ingredients we couldn't estimate (no match, or no amount for something substantial).
   */
  // Oil for frying is mostly left in the pan. Up to ~20 g a serving is treated as eaten (dressings, a normal
  // drizzle); beyond that, or when the recipe says it's for frying, only a realistic share is counted:
  // ~15% of the oil, and at least 10 g a serving.
  const OIL_KEY = 'olive oil';
  const OIL_EATEN_PER_SERVING = 20, FRY_SHARE = 0.15, FRY_MIN_PER_SERVING = 10;
  function oilCounted(ing, servings) {
    const frying = /fry|frying/i.test(ing.measure);
    if (frying && !ing.grams) return { grams: servings * FRY_MIN_PER_SERVING, listed: 0, note: 'for frying' };
    if (!frying && ing.grams <= OIL_EATEN_PER_SERVING * servings) return null;
    const grams = Math.min(ing.grams, Math.max(ing.grams * FRY_SHARE, servings * FRY_MIN_PER_SERVING));
    return { grams: Math.round(grams), listed: ing.grams, note: frying ? 'for frying' : 'a frying-sized amount' };
  }

  /**
   * Nutrition per serving and how much of the recipe it covers.
   * counted[i]: grams of each ingredient included (oil for frying is reduced — see oilCounted).
   * coverage.missing: ingredients we couldn't estimate. adjustments: what was reduced and why.
   */
  function nutrition(recipe, servings) {
    servings = Math.max(1, Math.round(servings) || 4);
    const total = {}; NUTRIENTS.forEach(k => { total[k] = 0; });
    const missing = [], adjustments = [], counted = [];
    let n = 0;
    for (const ing of recipe.ingredients) {
      counted.push(0);
      if (!ing.entry) { missing.push(ing.name); continue; }
      let grams = ing.grams;
      const oil = ing.entry.key === OIL_KEY ? oilCounted(ing, servings) : null;
      if (oil) { grams = oil.grams; adjustments.push({ name: ing.name, listed: oil.listed, counted: oil.grams, note: oil.note }); }
      else if (!grams && !NEGLIGIBLE.has(ing.entry.key) && ing.entry.per100.kcal > 50 && !/taste|garnish|serve/i.test(ing.measure)) { missing.push(ing.name); continue; }
      n++;
      counted[counted.length - 1] = grams;
      NUTRIENTS.forEach(k => { total[k] += ing.entry.per100[k] * grams / 100; });
    }
    const per = {}; NUTRIENTS.forEach(k => { per[k] = total[k] / servings; });
    return { servings, total, perServing: per, counted, adjustments, coverage: { counted: n, total: recipe.ingredients.length, missing } };
  }

  // ---------- pantry ----------
  const singular = w => w.replace(/(ies)$/, 'y').replace(/(oes|ches|shes|sses|xes)$/, m => m.slice(0, -2)).replace(/s$/, '');
  const ALWAYS_HAVE = new Set(['salt', 'water']);
  const PEPPER = /^(black |white |ground black )?pepper(corns)?$/;
  /** Is a recipe ingredient covered by something in the pantry? (Salt, pepper and water are assumed, unless strict.) */
  function pantryHas(pantry, ingredientName, strict) {
    const n = norm(ingredientName);
    const e = matchIngredient(ingredientName);
    if (!strict && ((e && ALWAYS_HAVE.has(e.key)) || PEPPER.test(n))) return true;
    const ns = n.split(' ').map(singular).join(' ');
    return pantry.some(p => {
      const ps = norm(p).split(' ').map(singular).join(' ');
      if (!ps) return false;
      if (ns === ps) return true;
      const pe = matchIngredient(p);
      // Both known: the same ingredient ("beef mince" = "Minced Beef", "spaghetti" = pasta) or a cut of the same
      // meat ("chicken" covers breasts and thighs). A word appearing inside isn't enough: "chicken" doesn't
      // cover "chicken stock cube", nor "rice" "rice vinegar".
      // (A cut only stands in for the general meat, not for another cut: breasts aren't thighs.)
      if (e && pe) return pe.key === e.key || (!!e.family && e.family === pe.family && (pe.key === e.family || e.key === e.family));
      // Otherwise your item must be the ingredient's main (last) word(s): "lemongrass" covers "fresh lemongrass",
      // not "lemongrass paste".
      const endsWith = (a, b) => a === b || a.endsWith(' ' + b);
      return endsWith(ns, ps) || endsWith(ps, ns);
    });
  }

  /** TheMealDB ingredient names to query for a pantry item ("chicken thighs" → "Chicken Thighs"). */
  function mealdbNamesFor(item, list) {
    const n = norm(item), s = n.split(' ').map(singular).join(' ');
    const lower = list.map(x => ({ x, n: norm(x) }));
    const exact = lower.filter(o => o.n === n || o.n === s || o.n === s + 's' || o.n === s + 'es');
    if (exact.length) return exact.slice(0, 2).map(o => o.x);
    // same thing, different words ("beef mince" = "Minced Beef", "spring onions" = "Scallions")
    const e = matchIngredient(item);
    if (e) {
      const same = lower.filter(o => { const oe = matchIngredient(o.x); return oe && oe.key === e.key; }).sort((a, b) => a.n.length - b.n.length);
      if (same.length) return same.slice(0, 2).map(o => o.x);
    }
    const contains = lower.filter(o => wordRe(s).test(o.n)).sort((a, b) => a.n.length - b.n.length);
    return contains.slice(0, 2).map(o => o.x);
  }

  /**
   * Recipes that use what you have: query each pantry item, rank by how many items a recipe uses,
   * fetch the best few in full and score them by what's still missing.
   */
  async function findByPantry(pantry, opts) {
    opts = opts || {};
    const list = await allIngredients(opts.signal).catch(() => []);
    const hits = new Map();
    for (const item of pantry.slice(0, 8)) {
      const names = list.length ? mealdbNamesFor(item, list) : [item];
      for (const name of (names.length ? names : [item])) {
        let meals = [];
        try { meals = await byIngredient(name, opts.signal); } catch (e) { if (opts.signal && opts.signal.aborted) throw e; }
        meals.forEach(m => {
          if (!hits.has(m.idMeal)) hits.set(m.idMeal, new Set());
          hits.get(m.idMeal).add(item);
        });
      }
    }
    const ranked = Array.from(hits.entries()).sort((a, b) => b[1].size - a[1].size).slice(0, opts.limit || 15).map(([id]) => id);
    const meals = await lookupMany(ranked, opts.signal, 4);
    return meals.map(fromMealDB).map(r => {
      const have = r.ingredients.filter(i => pantryHas(pantry, i.name));
      const need = r.ingredients.filter(i => !pantryHas(pantry, i.name));
      const used = pantry.filter(p => r.ingredients.some(i => pantryHas([p], i.name, true))); // your items it actually uses
      return Object.assign(r, { have: have.map(i => i.name), need: need.map(i => i.name), used });
    }).sort((a, b) => (b.used.length - a.used.length) || (a.need.length - b.need.length));
  }

  // ---------- shopping list ----------
  /**
   * Sum ingredients across planned recipes. items: [{ name, grams }]. Grouped by matched ingredient
   * (so "red onions" and "onion" add up), with what's already in the pantry flagged.
   */
  function shoppingList(items, pantry) {
    const map = new Map();
    for (const it of items) {
      if (!it || !it.name) continue;
      const e = matchIngredient(it.name);
      if (e && e.key === 'water') continue;
      const key = e ? e.key : norm(it.name);
      const label = e ? e.name : it.name;
      if (!map.has(key)) map.set(key, { key, name: label.charAt(0).toUpperCase() + label.slice(1), grams: 0, from: new Set() });
      const row = map.get(key);
      row.grams += Number(it.grams) || 0;
      if (it.recipe) row.from.add(it.recipe);
    }
    return Array.from(map.values()).map(r => Object.assign(r, { from: Array.from(r.from), have: pantryHas(pantry || [], r.name) }))
      .sort((a, b) => (a.have - b.have) || a.name.localeCompare(b.name));
  }

  return {
    INGREDIENTS, CATEGORIES, norm, safeUrl, matchIngredient, parseMeasure, toGrams, nutrition,
    searchByName, byCategory, byIngredient, lookup, lookupMany, allIngredients, fromMealDB,
    pantryHas, mealdbNamesFor, findByPantry, shoppingList,
  };
});
