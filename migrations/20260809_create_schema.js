exports.up = async function(knex) {
  await knex.schema.createTable('products', function(table) {
    table.increments('id').primary();
    table.string('name').notNullable();
    table.string('slug').notNullable().unique();
    table.text('description');
    table.decimal('base_price', 10, 2).notNullable().defaultTo(0);
    table.json('images').defaultTo(JSON.stringify([]));
    table.boolean('active').notNullable().defaultTo(true);
    table.timestamps(true, true);
  });

  await knex.schema.createTable('product_files', function(table) {
    table.increments('id').primary();
    table.integer('product_id').unsigned().notNullable().references('id').inTable('products').onDelete('CASCADE');
    table.string('file_name').notNullable();
    table.string('file_type').notNullable();
    table.decimal('file_price', 10, 2).notNullable().defaultTo(0);
    table.boolean('active').notNullable().defaultTo(true);
    table.timestamps(true, true);
  });

  await knex.schema.createTable('addons', function(table) {
    table.increments('id').primary();
    table.integer('product_id').unsigned().notNullable().references('id').inTable('products').onDelete('CASCADE');
    table.string('name').notNullable();
    table.text('description');
    table.decimal('price', 10, 2).notNullable().defaultTo(0);
    table.boolean('active').notNullable().defaultTo(true);
    table.timestamps(true, true);
  });

  await knex.schema.createTable('customers', function(table) {
    table.increments('id').primary();
    table.string('name').notNullable();
    table.string('email').notNullable().unique();
    table.string('phone');
    table.text('address');
    table.string('city');
    table.string('state');
    table.string('country');
    table.string('postal_code');
    table.timestamps(true, true);
  });

  await knex.schema.createTable('orders', function(table) {
    table.increments('id').primary();
    table.integer('customer_id').unsigned().notNullable().references('id').inTable('customers').onDelete('RESTRICT');
    table.decimal('subtotal', 10, 2).notNullable().defaultTo(0);
    table.decimal('addon_total', 10, 2).notNullable().defaultTo(0);
    table.decimal('physical_total', 10, 2).notNullable().defaultTo(0);
    table.decimal('trial_total', 10, 2).notNullable().defaultTo(0);
    table.decimal('grand_total', 10, 2).notNullable().defaultTo(0);
    table.string('order_status').notNullable().defaultTo('pending');
    table.string('payment_status').notNullable().defaultTo('unpaid');
    table.string('payment_reference');
    table.timestamps(true, true);
  });

  await knex.schema.createTable('order_items', function(table) {
    table.increments('id').primary();
    table.integer('order_id').unsigned().notNullable().references('id').inTable('orders').onDelete('CASCADE');
    table.integer('product_id').unsigned().notNullable().references('id').inTable('products').onDelete('RESTRICT');
    table.json('selected_files').defaultTo(JSON.stringify([]));
    table.json('selected_addons').defaultTo(JSON.stringify([]));
    table.integer('physical_quantity').unsigned().notNullable().defaultTo(0);
    table.integer('trial_quantity').unsigned().notNullable().defaultTo(0);
    table.decimal('unit_price', 10, 2).notNullable().defaultTo(0);
    table.decimal('total_price', 10, 2).notNullable().defaultTo(0);
    table.timestamps(true, true);
  });

  await knex.schema.createTable('payments', function(table) {
    table.increments('id').primary();
    table.integer('order_id').unsigned().notNullable().references('id').inTable('orders').onDelete('CASCADE');
    table.string('payment_provider');
    table.string('payment_id');
    table.string('payment_status');
    table.decimal('amount', 10, 2).notNullable().defaultTo(0);
    table.string('currency', 8).notNullable().defaultTo('INR');
    table.timestamps(true, true);
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('payments');
  await knex.schema.dropTableIfExists('order_items');
  await knex.schema.dropTableIfExists('orders');
  await knex.schema.dropTableIfExists('customers');
  await knex.schema.dropTableIfExists('addons');
  await knex.schema.dropTableIfExists('product_files');
  await knex.schema.dropTableIfExists('products');
};
