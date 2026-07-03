import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { defineBrick } from '../_shared/brick';

export const MEDIA_IDS = {
  videoPlayer: 'library.media.video_player',
  audioPlayer: 'library.media.audio_player',
  playlist: 'library.media.playlist'
} as const;

const videoPlayer = defineBrick({
  id: MEDIA_IDS.videoPlayer,
  name: 'Video player',
  category: 'media',
  surfaceType: 'screen',
  summary: 'Play/pause, seek, and quality selection with a valid position.',
  description:
    'A video surface. Playback toggles a flag, seeking binds a validated position, and quality is an explicit ladder enum.',
  surfaceName: 'Player',
  surfaceDescription: 'Watch a video with playback, seek, and quality controls.',
  tags: ['media', 'video', 'player', 'streaming'],
  siblings: [{ id: MEDIA_IDS.playlist, label: 'Playlist' }],
  states: [
    { path: 'video.playing', type: 'boolean', default: false, description: 'Whether playback is active.' },
    { path: 'video.positionSec', type: 'number', default: 0, description: 'Playhead position in seconds.' },
    { path: 'video.quality', type: 'enum', default: 'auto', description: 'Streaming quality.', enumValues: ['auto', '480p', '720p', '1080p'] }
  ],
  invariants: [
    { name: 'Position is non-negative', path: 'video.positionSec', op: 'greater_than', value: -1, message: 'Playhead position can never be negative.' }
  ],
  actions: [
    {
      name: 'Toggle playback',
      intent: 'Play or pause the video.',
      emits: 'video.playback.toggled',
      roles: ['primary'],
      params: [
        { name: 'play', type: 'boolean', description: 'Whether to play.', bindTo: 'video.playing' }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Playback toggled.', tone: 'info' } }]
    },
    {
      name: 'Seek',
      intent: 'Jump the playhead to a position.',
      emits: 'video.seeked',
      roles: ['primary'],
      params: [
        { name: 'positionSec', type: 'number', description: 'Target position in seconds.', bindTo: 'video.positionSec', validations: [{ type: 'min', value: 0 }, { type: 'integer' }] }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Seeking.', tone: 'info' } }]
    },
    {
      name: 'Set quality',
      intent: 'Change the streaming quality.',
      emits: 'video.quality.changed',
      roles: ['primary'],
      params: [
        { name: 'quality', type: 'enum', description: 'Quality.', enumValues: ['auto', '480p', '720p', '1080p'], bindTo: 'video.quality' }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Quality changed.', tone: 'info' } }]
    }
  ]
});

const audioPlayer = defineBrick({
  id: MEDIA_IDS.audioPlayer,
  name: 'Audio player',
  category: 'media',
  surfaceType: 'screen',
  summary: 'Compact audio transport with volume and repeat mode.',
  description:
    'A persistent audio bar. Play toggles a flag, volume binds a validated 0-100 value, and repeat is an explicit mode enum.',
  surfaceName: 'Audio',
  surfaceDescription: 'Play audio with volume and repeat controls.',
  tags: ['media', 'audio', 'player', 'music'],
  states: [
    { path: 'audio.playing', type: 'boolean', default: false, description: 'Whether audio is playing.' },
    { path: 'audio.volume', type: 'number', default: 80, description: 'Volume from 0 to 100.' },
    { path: 'audio.repeat', type: 'enum', default: 'off', description: 'Repeat mode.', enumValues: ['off', 'one', 'all'] }
  ],
  invariants: [
    { name: 'Volume is non-negative', path: 'audio.volume', op: 'greater_than', value: -1, message: 'Volume can never be negative.' }
  ],
  actions: [
    {
      name: 'Toggle play',
      intent: 'Play or pause the audio.',
      emits: 'audio.playback.toggled',
      roles: ['primary'],
      params: [
        { name: 'play', type: 'boolean', description: 'Whether to play.', bindTo: 'audio.playing' }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Playback toggled.', tone: 'info' } }]
    },
    {
      name: 'Set volume',
      intent: 'Change the playback volume.',
      emits: 'audio.volume.changed',
      roles: ['primary'],
      params: [
        { name: 'volume', type: 'number', description: 'Volume level.', bindTo: 'audio.volume', validations: [{ type: 'min', value: 0 }, { type: 'max', value: 100 }, { type: 'integer' }] }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Volume set.', tone: 'info' } }]
    }
  ]
});

const playlist = defineBrick({
  id: MEDIA_IDS.playlist,
  name: 'Playlist',
  category: 'media',
  surfaceType: 'screen',
  summary: 'Track list with add and empty-guarded removal.',
  description:
    'An ordered queue of tracks. Adding validates the track id and counts it; removing is blocked when the playlist is empty.',
  surfaceName: 'Playlist',
  surfaceDescription: 'Manage the ordered set of tracks to play.',
  tags: ['media', 'playlist', 'queue', 'tracks'],
  states: [
    { path: 'playlist.trackCount', type: 'number', default: 0, description: 'Tracks in the playlist.' },
    { path: 'playlist.currentIndex', type: 'number', default: 0, description: 'Currently playing index.' }
  ],
  invariants: [
    { name: 'Track count is non-negative', path: 'playlist.trackCount', op: 'greater_than', value: -1, message: 'Track count can never be negative.' }
  ],
  actions: [
    {
      name: 'Add track',
      intent: 'Append a track to the playlist.',
      emits: 'playlist.track.added',
      roles: ['primary'],
      params: [
        { name: 'trackId', type: 'string', description: 'Track id.', validations: [{ type: 'non_empty' }, { type: 'uuid' }] }
      ],
      rules: [{ category: 'business', description: 'Count the added track.', set: { path: 'playlist.trackCount', value: 1 } }]
    },
    {
      name: 'Remove track',
      intent: 'Remove a track from the playlist.',
      emits: 'playlist.track.removed',
      roles: ['primary'],
      requiredStates: ['playlist.trackCount'],
      params: [
        { name: 'trackId', type: 'string', description: 'Track id.', validations: [{ type: 'non_empty' }, { type: 'uuid' }] }
      ],
      rules: [
        { category: 'business', when: { path: 'playlist.trackCount', op: 'equals', value: 0 }, block: 'The playlist is empty.' }
      ]
    }
  ]
});

export const mediaBlueprints: readonly SurfaceBlueprint[] = [videoPlayer, audioPlayer, playlist];
