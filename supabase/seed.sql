-- Starter categories. Optional — run once after schema.sql if you want the app
-- to open with sensible groupings instead of a blank slate.

insert into categories (name, icon, color, sort_order) values
  ('Pantry',          'box',    '#2fd6a4',  10),
  ('Refrigerated',    'fridge', '#5fb0ff',  20),
  ('Frozen',          'snow',   '#8fd4ff',  30),
  ('Beverages',       'cup',    '#b892ff',  40),
  ('Cleaning',        'spray',  '#6ee7b7',  50),
  ('Paper & Plastic', 'roll',   '#f5b544',  60),
  ('Toiletries',      'soap',   '#ff8fa3',  70),
  ('Medicine',        'pill',   '#ff6b6b',  80),
  ('Pet',             'paw',    '#f0a868',  90),
  ('Tools',           'hammer', '#a8bac4', 100),
  ('Hardware',        'bolt',   '#8f9fa8', 110),
  ('Batteries',       'bolt',   '#f5b544', 120),
  ('Other',           'dots',   '#6f838e', 999)
on conflict do nothing;
