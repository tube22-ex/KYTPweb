import { useState, useEffect, useRef, useCallback } from 'react';

export function useYTPlayer(videoId: string | undefined, volume: number) {
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const playerRef = useRef<any>(null);

  const initPlayer = useCallback(() => {
    if (!videoId || !(window as any).YT || !(window as any).YT.Player) return;
    
    if (playerRef.current) {
      try { playerRef.current.destroy(); } catch (_) { }
    }

    playerRef.current = new (window as any).YT.Player('editor-youtube-player', {
      height: '180',
      width: '320',
      videoId,
      playerVars: { autoplay: 0, controls: 1, disablekb: 1, modestbranding: 1, rel: 0 },
      events: {
        onReady: (e: any) => {
          setDuration(e.target.getDuration());
          e.target.setVolume(volume);
        }
      }
    });
  }, [videoId, volume]);

  useEffect(() => {
    if (!videoId) return;

    if ((window as any).YT?.Player) {
      initPlayer();
    } else {
      const prev = (window as any).onYouTubeIframeAPIReady;
      (window as any).onYouTubeIframeAPIReady = () => {
        initPlayer();
        if (prev) prev();
      };
      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const s = document.createElement('script');
        s.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(s);
      }
    }

    const iv = setInterval(() => {
      try {
        if (playerRef.current?.getCurrentTime) {
          setCurrentTime(playerRef.current.getCurrentTime());
          setIsPlaying(playerRef.current.getPlayerState() === 1);
        }
      } catch (_) { }
    }, 100);

    return () => {
      clearInterval(iv);
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch (_) { }
        playerRef.current = null;
      }
    };
  }, [videoId, initPlayer]);

  useEffect(() => {
    if (playerRef.current?.setVolume) {
      try { playerRef.current.setVolume(volume); } catch (_) { }
    }
  }, [volume]);

  const seekTo = (time: number) => {
    if (playerRef.current?.seekTo) {
      playerRef.current.seekTo(time, true);
    }
  };

  const togglePlay = () => {
    if (!playerRef.current) return;
    if (isPlaying) {
      playerRef.current.pauseVideo();
    } else {
      playerRef.current.playVideo();
    }
  };

  return { currentTime, isPlaying, duration, seekTo, togglePlay, playerRef };
}
