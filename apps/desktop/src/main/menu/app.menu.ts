import { app, Menu, type MenuItemConstructorOptions } from 'electron';
import { getMainWindow } from '../windows/main.window';

type ImportMenuMode = "presentation" | "images";

/**
 * Build and set the application menu
 */
export const setupMenu = (openSettingsCallback: () => void): void => {
  const isMac = process.platform === 'darwin';
  const sendImportEvent = (mode: ImportMenuMode) => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    mainWindow.focus();
    mainWindow.webContents.send('open-import', mode);
  };
  
  const makeSettingsItem = (): MenuItemConstructorOptions => ({
    label: 'Settings…',
    accelerator: 'CmdOrCtrl+,',
    click: () => openSettingsCallback(),
  });

  const template: MenuItemConstructorOptions[] = [];

  if (isMac) {
    const appSubmenu: MenuItemConstructorOptions[] = [
      makeSettingsItem(),
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ];
    template.push({
      label: app.name,
      submenu: appSubmenu,
    });
  }

  const fileSubmenu: MenuItemConstructorOptions[] = [
    {
      label: 'Import',
      submenu: [
        {
          label: 'Presentation…',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendImportEvent("presentation"),
        },
        {
          label: 'Presentation As Images…',
          click: () => sendImportEvent("images"),
        },
      ],
    },
    { type: 'separator' },
    makeSettingsItem(),
    { type: 'separator' },
    isMac ? { role: 'close' } : { role: 'quit' },
  ];

  const editSubmenu: MenuItemConstructorOptions[] = [
    { role: 'undo' },
    { role: 'redo' },
    { type: 'separator' },
    { role: 'cut' },
    { role: 'copy' },
    { role: 'paste' },
  ];
  
  if (isMac) {
    editSubmenu.push(
      { role: 'pasteAndMatchStyle' },
      { role: 'delete' },
      { role: 'selectAll' },
    );
  } else {
    editSubmenu.push(
      { role: 'delete' },
      { type: 'separator' },
      { role: 'selectAll' },
    );
  }

  const viewSubmenu: MenuItemConstructorOptions[] = [
    { role: 'reload' },
    { role: 'forceReload' },
    { role: 'toggleDevTools' },
    { type: 'separator' },
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { type: 'separator' },
    { role: 'togglefullscreen' },
  ];

  const windowSubmenu: MenuItemConstructorOptions[] = isMac
    ? [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ]
    : [{ role: 'minimize' }, { role: 'close' }];

  template.push(
    {
      label: 'File',
      submenu: fileSubmenu,
    },
    {
      label: 'Edit',
      submenu: editSubmenu,
    },
    {
      label: 'View',
      submenu: viewSubmenu,
    },
    {
      label: 'Window',
      submenu: windowSubmenu,
    },
  );

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};
