import { testPlex } from './media-connectors.contract.plex';
import { testEmby } from './media-connectors.contract.emby';
import { testMoviePilot } from './media-connectors.contract.moviepilot';

async function main() {
  await testPlex();
  await testEmby();
  await testMoviePilot();
  console.log('媒体连接器契约测试通过：Plex、Emby、MoviePilot');
}

void main();
