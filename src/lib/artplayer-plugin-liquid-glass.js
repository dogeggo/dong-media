// artplayer-plugin-liquid-glass
// 毛玻璃效果控制栏插件
// 样式已提取到 src/styles/artplayer-liquid-glass.css

export default function artplayerPluginLiquidGlass(option = {}) {
  return (art) => {
    const { constructor } = art;
    const { addClass, append, createElement } = constructor.utils;
    const { $bottom, $progress, $controls, $player, $setting } = art.template;

    const $liquidGlass = createElement('div');
    addClass($player, 'artplayer-plugin-liquid-glass');
    addClass($liquidGlass, 'art-liquid-glass');

    // 恢复官方实现：progress和controls一起包裹
    append($bottom, $liquidGlass);
    append($liquidGlass, $progress);
    append($liquidGlass, $controls);

    const isMobileLandscape = () =>
      $player.classList.contains('art-mobile') &&
      (art.isRotate || window.matchMedia('(orientation: landscape)').matches);

    const getPlayerOffsetLeft = ($element) => {
      let left = 0;
      let $current = $element;

      while ($current && $current !== $player) {
        left += $current.offsetLeft;
        $current = $current.offsetParent;
      }

      return left;
    };

    let hasAlignedMobileSetting = false;

    const alignSettingPanel = () => {
      if (art.isDestroy || !$setting.isConnected) return;

      if (!isMobileLandscape()) {
        if (hasAlignedMobileSetting) {
          $setting.style.removeProperty('left');
          $setting.style.removeProperty('right');
          hasAlignedMobileSetting = false;
        }
        return;
      }

      const $settingControl = art.controls.setting;
      if (!$settingControl || !art.setting.show) return;

      const edgeGap = 10;
      const centeredLeft =
        getPlayerOffsetLeft($settingControl) +
        ($settingControl.offsetWidth - $setting.offsetWidth) / 2;
      const maxLeft = Math.max(
        edgeGap,
        $player.clientWidth - $setting.offsetWidth - edgeGap,
      );
      const left = Math.min(Math.max(centeredLeft, edgeGap), maxLeft);

      $setting.style.left = `${left}px`;
      $setting.style.right = 'auto';
      hasAlignedMobileSetting = true;
    };

    const scheduleSettingAlignment = () => {
      window.requestAnimationFrame(alignSettingPanel);
    };

    art.on('setting', (show) => {
      if (show) scheduleSettingAlignment();
    });
    art.on('resize', scheduleSettingAlignment);

    // 移除control事件监听，完全由CSS控制宽度
    // 避免与CSS的!important冲突，防止拖动进度条时布局错乱

    return {
      name: 'artplayerPluginLiquidGlass',
    };
  };
}

if (typeof window !== 'undefined') {
  window.artplayerPluginLiquidGlass = artplayerPluginLiquidGlass;
}
