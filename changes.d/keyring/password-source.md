 -  Added OS credential-store password fallback through `@optique/keyring`, so
    applications can keep secrets out of configuration files. Missing
    credentials allow a fallback, while locked, inaccessible, or ambiguous
    credential-store errors reject the parse. Keyring values take precedence
    over inner fallbacks, including when used as dependency sources. The
    credential store is accessed only when a password fallback is needed,
    including in two-pass runs. Bound parsers preserve the inner parser's
    help output and dependency sources inside selected commands and
    alternatives. Stored-password validation failures hide their original
    details so passwords do not appear in error output.
    [[#886] by black7375]
