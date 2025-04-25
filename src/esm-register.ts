import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('jttx/dist/jttx.js', pathToFileURL('./').toString());
