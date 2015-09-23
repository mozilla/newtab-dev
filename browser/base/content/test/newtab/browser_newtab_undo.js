/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

/*
 * These tests make sure that the undo dialog works as expected.
 */
function runTests() {
  yield addNewTabPageTab();
  yield whenPagesUpdated();

  // remove unpinned sites and undo it
  yield setLinks("0,1,2,3,4,5,6,7,8");
  yield addNewTabPageTab();
  setPinnedLinks("5");

  yield whenPagesUpdated();
  checkGrid("5p,0,1,2,3,4,6,7,8");

  yield blockCell(4);
  yield blockCell(4);
  checkGrid("5p,0,1,2,6,7,8");

  yield undo();
  yield whenPagesUpdated();
  checkGrid("5p,0,1,2,4,6,7,8");

  // now remove a pinned site and undo it
  yield blockCell(0);
  checkGrid("0,1,2,4,6,7,8");

  yield undo();
  yield whenPagesUpdated();
  checkGrid("5p,0,1,2,4,6,7,8");

  // remove a site and restore all
  yield blockCell(1);
  checkGrid("5p,1,2,4,6,7,8");

  yield undoAll();
  yield whenPagesUpdated();
  checkGrid("5p,0,1,2,3,4,6,7,8");
}
