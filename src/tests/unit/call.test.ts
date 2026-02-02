import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { parseCallArgs, loadJsonParams } from '../../commands/call.js';

describe('call command', () => {
  describe('parseCallArgs', () => {
    it('should parse string values in default mode', () => {
      const args = ['name=Alice', 'url=https://example.com'];
      const result = parseCallArgs(args, false);
      
      expect(result).toEqual({
        name: 'Alice',
        url: 'https://example.com'
      });
    });

    it('should parse numbers and booleans in default mode', () => {
      const args = ['count=10', 'active=true', 'score=3.14'];
      const result = parseCallArgs(args, false);
      
      expect(result).toEqual({
        count: 10,
        active: true,
        score: 3.14
      });
    });

    it('should parse JSON objects in default mode', () => {
      const args = ['user={"name":"Alice","age":30}'];
      const result = parseCallArgs(args, false);
      
      expect(result).toEqual({
        user: { name: 'Alice', age: 30 }
      });
    });

    it('should treat all values as strings in raw mode', () => {
      const args = ['id=123', 'count=10', 'active=true', 'pi=3.14'];
      const result = parseCallArgs(args, true);
      
      expect(result).toEqual({
        id: '123',
        count: '10',
        active: 'true',
        pi: '3.14'
      });
    });

    it('should handle empty args', () => {
      expect(parseCallArgs(undefined, false)).toEqual({});
      expect(parseCallArgs([], false)).toEqual({});
    });

    it('should handle args without equals sign', () => {
      const args = ['invalid', 'name=Alice', 'noequals'];
      const result = parseCallArgs(args, false);
      
      expect(result).toEqual({
        name: 'Alice'
      });
    });

    it('should handle values with equals sign', () => {
      const args = ['equation=1+1=2', 'url=https://example.com?a=1&b=2'];
      const result = parseCallArgs(args, false);
      
      expect(result).toEqual({
        equation: '1+1=2',
        url: 'https://example.com?a=1&b=2'
      });
    });
  });

  describe('loadJsonParams', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = path.join(os.tmpdir(), `mcps-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
      fs.mkdirSync(tempDir, { recursive: true });
    });

    afterEach(() => {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should parse JSON string starting with {', () => {
      const jsonStr = '{"key": "value", "number": 42}';
      const result = loadJsonParams(jsonStr);
      
      expect(result).toEqual({
        key: 'value',
        number: 42
      });
    });

    it('should parse JSON string starting with [', () => {
      const jsonStr = '[{"id": 1}, {"id": 2}]';
      const result = loadJsonParams(jsonStr);
      
      expect(result).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it('should load and parse JSON from file', () => {
      const testFile = path.join(tempDir, 'params.json');
      const testData = { name: 'test', value: 123 };
      fs.writeFileSync(testFile, JSON.stringify(testData));

      const result = loadJsonParams(testFile);
      
      expect(result).toEqual(testData);
    });

    it('should handle JSON string with leading/trailing whitespace', () => {
      const jsonStr = '  {"key": "value"}  ';
      const result = loadJsonParams(jsonStr);
      
      expect(result).toEqual({ key: 'value' });
    });

    it('should throw error for invalid JSON string', () => {
      expect(() => loadJsonParams('not valid json')).toThrow();
    });

    it('should throw error for non-existent file', () => {
      const nonExistentFile = path.join(tempDir, 'non-existent.json');
      expect(() => loadJsonParams(nonExistentFile)).toThrow();
    });

    it('should throw error for invalid JSON in file', () => {
      const testFile = path.join(tempDir, 'invalid.json');
      fs.writeFileSync(testFile, 'not valid json');

      expect(() => loadJsonParams(testFile)).toThrow();
    });
  });
});
