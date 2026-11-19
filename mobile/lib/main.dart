import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:webview_flutter/webview_flutter.dart';

// A thin native shell around the perks shop (frontend/phone.html, served by the FedAd backend).
// First launch asks for the server address (your Render URL or a laptop on the same Wi-Fi) and remembers it.
// Triple-tap the top-left corner to change it later. Build with a default: --dart-define=SERVER_URL=https://your-app.onrender.com
const String kDefaultServer = String.fromEnvironment('SERVER_URL', defaultValue: '');
const Color kBg = Color(0xFFF4F1EA);
const Color kInk = Color(0xFF15120F);
const Color kGreen = Color(0xFF0B7A57);

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: kBg,
    statusBarIconBrightness: Brightness.dark,
    systemNavigationBarColor: kBg,
    systemNavigationBarIconBrightness: Brightness.dark,
  ));
  runApp(const PerksApp());
}

class PerksApp extends StatelessWidget {
  const PerksApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'Perks',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          useMaterial3: true,
          colorScheme: ColorScheme.fromSeed(seedColor: kGreen),
          scaffoldBackgroundColor: kBg,
        ),
        home: const Root(),
      );
}

class Root extends StatefulWidget {
  const Root({super.key});

  @override
  State<Root> createState() => _RootState();
}

class _RootState extends State<Root> {
  String? server;
  bool ready = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    setState(() {
      server = prefs.getString('server') ?? (kDefaultServer.isEmpty ? null : kDefaultServer);
      ready = true;
    });
  }

  Future<void> _save(String? url) async {
    final prefs = await SharedPreferences.getInstance();
    if (url == null) {
      await prefs.remove('server');
    } else {
      await prefs.setString('server', url);
    }
    setState(() => server = url);
  }

  @override
  Widget build(BuildContext context) {
    if (!ready) return const Scaffold(body: SizedBox.shrink());
    if (server == null) return Setup(onDone: _save);
    return Shop(server: server!, onChange: () => _save(null));
  }
}

String normalise(String raw) {
  var s = raw.trim();
  if (s.isEmpty) return '';
  if (!s.startsWith('http://') && !s.startsWith('https://')) {
    s = (s.contains('onrender.com') ? 'https://' : 'http://') + s;
  }
  s = s.replaceAll(RegExp(r'/phone\.html.*$'), '').replaceAll(RegExp(r'/+$'), '');
  return s;
}

Future<bool> reachable(String base) async {
  final client = HttpClient()..connectionTimeout = const Duration(seconds: 8);
  try {
    final req = await client.getUrl(Uri.parse('$base/healthz')).timeout(const Duration(seconds: 25));
    final res = await req.close().timeout(const Duration(seconds: 25));
    await res.drain<void>();
    return res.statusCode == 200;
  } catch (_) {
    return false;
  } finally {
    client.close(force: true);
  }
}

class Setup extends StatefulWidget {
  const Setup({super.key, required this.onDone});
  final Future<void> Function(String url) onDone;

  @override
  State<Setup> createState() => _SetupState();
}

class _SetupState extends State<Setup> {
  final ctl = TextEditingController();
  String? error;
  bool busy = false;

  Future<void> _go() async {
    final url = normalise(ctl.text);
    if (url.isEmpty) return;
    setState(() {
      busy = true;
      error = null;
    });
    final ok = await reachable(url);
    if (!mounted) return;
    if (ok) {
      await widget.onDone(url);
    } else {
      setState(() {
        busy = false;
        error = 'Cannot reach it';
      });
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Text.rich(TextSpan(children: [
                  TextSpan(text: 'perks', style: TextStyle(fontSize: 44, fontWeight: FontWeight.w800, letterSpacing: -2, color: kInk)),
                  TextSpan(text: '.', style: TextStyle(fontSize: 44, fontWeight: FontWeight.w800, color: kGreen)),
                ])),
                const SizedBox(height: 28),
                TextField(
                  controller: ctl,
                  keyboardType: TextInputType.url,
                  autocorrect: false,
                  enableSuggestions: false,
                  decoration: InputDecoration(
                    hintText: 'Server address',
                    filled: true,
                    fillColor: Colors.white,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
                    errorText: error,
                  ),
                  onSubmitted: (_) => _go(),
                ),
                const SizedBox(height: 14),
                SizedBox(
                  width: double.infinity,
                  height: 54,
                  child: FilledButton(
                    style: FilledButton.styleFrom(backgroundColor: kInk, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14))),
                    onPressed: busy ? null : _go,
                    child: busy
                        ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
                        : const Text('Open', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
}

class Shop extends StatefulWidget {
  const Shop({super.key, required this.server, required this.onChange});
  final String server;
  final VoidCallback onChange;

  @override
  State<Shop> createState() => _ShopState();
}

class _ShopState extends State<Shop> {
  late final WebViewController controller;
  bool failed = false;
  bool loading = true;
  int corner = 0;
  Timer? cornerTimer;

  // Back closes an open sheet or product page inside the web app first; only then does it leave the app.
  static const String closeTop =
      "(function(){var s=document.querySelectorAll('.sheet-bg');if(s.length){s[s.length-1].click();return true;}"
      "var b=document.querySelector('.page .back');if(b){b.click();return true;}return false;})()";

  @override
  void initState() {
    super.initState();
    controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(kBg)
      ..setNavigationDelegate(NavigationDelegate(
        onPageFinished: (_) => setState(() => loading = false),
        onWebResourceError: (e) {
          if (e.isForMainFrame ?? true) setState(() => failed = true);
        },
      ));
    _open();
  }

  void _open() {
    setState(() {
      failed = false;
      loading = true;
    });
    controller.loadRequest(Uri.parse('${widget.server}/phone.html'));
  }

  Future<void> _back() async {
    final handled = await controller.runJavaScriptReturningResult(closeTop);
    if (handled.toString() == 'true') return;
    if (await controller.canGoBack()) {
      await controller.goBack();
    } else {
      SystemNavigator.pop();
    }
  }

  void _cornerTap() {
    corner++;
    cornerTimer?.cancel();
    cornerTimer = Timer(const Duration(milliseconds: 900), () => corner = 0);
    if (corner >= 3) {
      corner = 0;
      widget.onChange();
    }
  }

  @override
  void dispose() {
    cornerTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => PopScope(
        canPop: false,
        onPopInvokedWithResult: (didPop, _) {
          if (!didPop) _back();
        },
        child: Scaffold(
          body: SafeArea(
            child: Stack(children: [
              if (!failed) WebViewWidget(controller: controller),
              if (loading && !failed) const Center(child: CircularProgressIndicator(color: kGreen)),
              if (failed)
                Center(
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    const Icon(Icons.wifi_off_rounded, size: 56, color: kInk),
                    const SizedBox(height: 18),
                    FilledButton(style: FilledButton.styleFrom(backgroundColor: kInk), onPressed: _open, child: const Text('Retry')),
                    TextButton(onPressed: widget.onChange, child: const Text('Change server')),
                  ]),
                ),
              Positioned(left: 0, top: 0, width: 56, height: 56, child: GestureDetector(behavior: HitTestBehavior.translucent, onTap: _cornerTap)),
            ]),
          ),
        ),
      );
}
