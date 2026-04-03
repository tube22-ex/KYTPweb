import { useState, useEffect } from 'react';

export function useSettings() {
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem('kytp_volume');
    return saved ? Number(saved) : 50;
  });

  const [seVolume, setSeVolume] = useState(() => {
    const saved = localStorage.getItem('kytp_se_volume');
    return saved ? Number(saved) : 60;
  });

  const [selectedFont, setSelectedFont] = useState(() => {
    return localStorage.getItem('kytp_font') || "'Noto Sans Mono', monospace";
  });

  const [hideVideo, setHideVideo] = useState(() => {
    return localStorage.getItem('kytp_hide_video') === 'true';
  });

  useEffect(() => {
    localStorage.setItem('kytp_volume', volume.toString());
  }, [volume]);

  useEffect(() => {
    localStorage.setItem('kytp_se_volume', seVolume.toString());
    (window as any).typeVolume = seVolume / 100;
    (window as any).clearVolume = seVolume / 100;
    (window as any).missVolume = seVolume / 100;
  }, [seVolume]);

  useEffect(() => {
    localStorage.setItem('kytp_font', selectedFont);
  }, [selectedFont]);

  useEffect(() => {
    localStorage.setItem('kytp_hide_video', hideVideo.toString());
  }, [hideVideo]);

  return {
    volume, setVolume,
    seVolume, setSeVolume,
    selectedFont, setSelectedFont,
    hideVideo, setHideVideo
  };
}
