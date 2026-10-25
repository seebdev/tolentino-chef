import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {parseProductsCsv} from '../src/lib/csv';
describe('equivalent synthetic 123-product CSV supplied for reproducible local acceptance',()=>{
 it('parses every UTF-8 row, price, category and SKU without skipped rows',()=>{
  const result=parseProductsCsv(readFileSync('tests/fixtures/productos-equivalentes-123.csv','utf8'));
  expect(result.errors).toEqual([]);expect(result.rows).toHaveLength(123);
  expect(new Set(result.rows.map(row=>row.sku)).size).toBe(123);
  expect(result.rows[0]).toMatchObject({name:'Café de muestra 1',price:12.5,sku:'QA-0001'});
  expect(result.rows.at(-1)?.sku).toBe('QA-0123');
 });
});
