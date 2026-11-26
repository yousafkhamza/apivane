// Starter workspace: free public APIs that allow browser (CORS) calls, each showing one feature.
import { newRequest } from '../core/index.js';
import { uid } from './dom.js';

const P = (k, v, on = true) => ({ k, v, on });
const R = (o) => ({ id: uid(), ...newRequest({ auth: { type: 'none' }, ...o }) });

export const SAMPLE_INFO = {
  'Dubai weather now': 'Live wind direction — no key needed',
  'Log in': 'Gets a token and saves it as {{token}}',
  'Who am I': 'Reuses the saved token',
  'List posts': 'Classic fake REST API',
  'Create post': 'POST with a JSON body',
  'Country: UAE': 'REST Countries open data',
  'Pokémon: Pikachu': 'Big JSON — try timing',
  'Key in the URL': 'Triggers a security finding',
  'Server error 500': 'See a failing test',
  'API without CORS': 'Blocked in a browser — see the fix',
};

export function sampleWorkspace() {
  return {
    version: 1,
    name: 'Sample APIs',
    auth: { type: 'none' },
    envs: [
      { id: 'env-public', name: 'Public demo', vars: [
        { k: 'jsonph', v: 'https://jsonplaceholder.typicode.com' },
        { k: 'dummy', v: 'https://dummyjson.com' },
        { k: 'httpbin', v: 'https://httpbin.org' },
        { k: 'city_lat', v: '25.2' },
        { k: 'city_lon', v: '55.27' },
      ] },
      { id: 'env-staging', name: 'Staging (example)', vars: [
        { k: 'jsonph', v: 'https://staging.example.com' },
        { k: 'apiKey', v: 'replace-me', secret: true },
      ] },
    ],
    activeEnvId: 'env-public',
    requests: [
      R({ folder: 'Weather', name: 'Dubai weather now', url: 'https://api.open-meteo.com/v1/forecast',
        params: [P('latitude', '{{city_lat}}'), P('longitude', '{{city_lon}}'), P('current', 'temperature_2m,wind_speed_10m,wind_direction_10m')],
        tests: [{ status: 200 }, { jsonpath: '$.current.wind_direction_10m', exists: true }, { header: 'content-type', contains: 'json' }, { maxDurationMs: 2000 }] }),
      R({ folder: 'Auth flow', name: 'Log in', method: 'POST', url: '{{dummy}}/auth/login',
        body: { type: 'json', content: '{\n  "username": "emilys",\n  "password": "emilyspass",\n  "expiresInMins": 30\n}' },
        tests: [{ status: 200 }, { jsonpath: '$.accessToken', exists: true }], capture: { token: '$.accessToken' } }),
      R({ folder: 'Auth flow', name: 'Who am I', url: '{{dummy}}/auth/me', auth: { type: 'bearer', token: '{{token}}' },
        tests: [{ status: 200 }, { jsonpath: '$.username', equals: 'emilys' }] }),
      R({ folder: 'Fake REST', name: 'List posts', url: '{{jsonph}}/posts', params: [P('_limit', '3')],
        tests: [{ status: 200 }, { jsonpath: '$[0].id', exists: true }, { maxDurationMs: 1500 }] }),
      R({ folder: 'Fake REST', name: 'Create post', method: 'POST', url: '{{jsonph}}/posts',
        body: { type: 'json', content: '{\n  "title": "Hello from ApiVane",\n  "body": "Testing a POST",\n  "userId": 1\n}' },
        tests: [{ status: 201 }, { jsonpath: '$.id', exists: true }], capture: { postId: '$.id' } }),
      R({ folder: 'Open data', name: 'Country: UAE', url: 'https://restcountries.com/v3.1/alpha/ae', params: [P('fields', 'name,capital,population,currencies')],
        tests: [{ status: 200 }, { jsonpath: '$.capital', exists: true }] }),
      R({ folder: 'Open data', name: 'Pokémon: Pikachu', url: 'https://pokeapi.co/api/v2/pokemon/pikachu',
        tests: [{ status: 200 }, { jsonpath: '$.name', equals: 'pikachu' }, { maxDurationMs: 1500 }] }),
      R({ folder: 'Learn the limits', name: 'Key in the URL', url: '{{httpbin}}/get', params: [P('api_key', 'demo-123')], headers: [P('X-Trace', 'apivane')] }),
      R({ folder: 'Learn the limits', name: 'Server error 500', url: '{{httpbin}}/status/500' }),
      R({ folder: 'Learn the limits', name: 'API without CORS', url: 'https://example.com/' }),
    ],
  };
}
