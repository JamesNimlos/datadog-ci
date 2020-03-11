jest.mock('glob');
jest.useFakeTimers();

import * as fs from 'fs';
import glob from 'glob';

import { getSuites } from '../utils';

describe('utils', () => {
  describe('getSuites', () => {
    const GLOB = 'testGlob';
    const FILES = [ 'file1', 'file2' ];
    const FILES_CONTENT = { file1: '{"content":"file1"}', file2: '{"content":"file2"}' };

    jest.spyOn(fs.promises, 'readFile').mockImplementation(path =>
      Promise.resolve(FILES_CONTENT[path as 'file1' | 'file2'])
    );

    (glob as any).mockImplementation((query: string, callback: (e: any, v: any) => void) => callback(undefined, FILES));

    test('should get suites', async () => {
      const suites = await getSuites(GLOB, process.stdout.write);
      expect(JSON.stringify(suites)).toBe(`[${FILES_CONTENT.file1},${FILES_CONTENT.file2}]`);
    });
  });
});
