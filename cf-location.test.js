import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeKey, resolveCity, resolveRegion, toLocation } from './cf-location.js';

test('normalizeKey ignores case, accents and punctuation', () => {
  assert.equal(normalizeKey(' MÁLAGA '), 'malaga');
  assert.equal(normalizeKey('Malaga'), 'malaga');
  assert.equal(normalizeKey('San  Sebastián-de los Reyes'), 'san sebastian de los reyes');
  assert.equal(normalizeKey('   '), null);
  assert.equal(normalizeKey(null), null);
});

test('resolveCity drops the state suffix and tidies all-caps/all-lowercase', () => {
  assert.deepEqual(resolveCity('Guadalajara, Jal.'), { name: 'Guadalajara', key: 'guadalajara' });
  assert.deepEqual(resolveCity('LAS CABEZAS DE SAN JUAN'), { name: 'Las Cabezas de San Juan', key: 'las cabezas de san juan' });
  assert.deepEqual(resolveCity('cutler bay'), { name: 'Cutler Bay', key: 'cutler bay' });
  assert.deepEqual(resolveCity('Olesa de Montserrat'), { name: 'Olesa de Montserrat', key: 'olesa de montserrat' });
  assert.equal(resolveCity(''), null);
});

test('resolveRegion maps codes and names to one canonical region', () => {
  assert.deepEqual(resolveRegion('ES', 'M'), { name: 'Madrid', key: 'M' });
  assert.deepEqual(resolveRegion('ES', 'madrid'), { name: 'Madrid', key: 'M' });
  assert.deepEqual(resolveRegion('ES', 'Sevilla'), { name: 'Sevilla', key: 'SE' });
  assert.deepEqual(resolveRegion('US', 'tx'), { name: 'Texas', key: 'TX' });
  assert.deepEqual(resolveRegion('MX', 'PUE'), { name: 'Puebla', key: 'PUE' });
  assert.deepEqual(resolveRegion('CL', 'RM'), { name: 'Región Metropolitana', key: 'RM' });
});

test('resolveRegion maps common aliases', () => {
  assert.deepEqual(resolveRegion('MX', 'CDMX'), { name: 'Ciudad de México', key: 'CMX' });
  assert.deepEqual(resolveRegion('ES', 'La Coruña'), { name: 'A Coruña', key: 'C' });
  assert.deepEqual(resolveRegion('AR', 'Caba'), { name: 'Ciudad Autónoma de Buenos Aires', key: 'C' });
});

test('resolveRegion keeps unknown values as typed', () => {
  assert.deepEqual(resolveRegion('DE', 'Rhineland-Palatinate'), { name: 'Rhineland-Palatinate', key: 'rhineland palatinate' });
  assert.deepEqual(resolveRegion('PL', 'wp'), { name: 'WP', key: 'wp' });
  assert.equal(resolveRegion('ES', ''), null);
});

test('toLocation uses the latest order with an address, billing first', () => {
  const orders = [
    { created_at: '2024-01-01', billing_address_city: 'Oldtown', billing_address_country: 'US', billing_address_region: 'TX' },
    {
      created_at: '2025-01-01',
      billing_address_city: null,
      shipping_address_city: 'MADRID', shipping_address_region: 'M', shipping_address_country: 'es',
    },
  ];
  assert.deepEqual(toLocation(orders), {
    country: 'ES', region: 'Madrid', regionKey: 'M', city: 'Madrid', cityKey: 'madrid',
  });
});

test('toLocation is all null without an address', () => {
  assert.deepEqual(toLocation([]), { country: null, region: null, regionKey: null, city: null, cityKey: null });
});
