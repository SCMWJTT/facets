; Facets installer additions (requirements 25.3).
; The uninstaller never deletes a library folder. Libraries live wherever the owner created them
; (by default in Pictures) and are not part of the program folder.
; Settings in %APPDATA%\Facets are kept unless the owner chooses to remove them.
; Legend is a separate program (its own app ID, folder and settings) and is never touched.

!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also remove Facets settings?$\r$\n$\r$\nThis removes window layout, recent libraries and thumbnail preferences from $APPDATA\Facets.$\r$\n$\r$\nYour libraries and photos are never removed." /SD IDNO IDNO keepSettings
      RMDir /r "$APPDATA\Facets"
    keepSettings:
  ${endIf}
!macroend
