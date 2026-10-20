/* ------------------------------------------------------------------
   여러 화면이 함께 쓰는 작은 도우미 — 연도 글자, 장면 목록
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  function yearLabel(year) {
    return year < 0 ? '기원전 ' + Math.abs(year) : String(year);
  }

  function periodLabel(start, end) {
    if (start === end) return yearLabel(start) + '년';
    return yearLabel(start) + '년 ~ ' + yearLabel(end) + '년';
  }

  /**
   * 시대의 장면 목록. 매니페스트 eras[].scenes 가 있으면 그것을, 없으면 시대 디오라마 한 장을 장면 하나로 본다.
   */
  function scenesOf(era) {
    if (era.scenes && era.scenes.length) return era.scenes;
    return era.diorama ? [{ id: era.id, start_year: era.start_year, diorama: era.diorama }] : [];
  }

  global.BigHistoryCommon = {
    yearLabel: yearLabel,
    periodLabel: periodLabel,
    scenesOf: scenesOf
  };
})(window);
