import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.awt.Desktop;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Map;

/**
 * Zero-dependency launcher for Arrowvania. Serves the static game files over
 * http on localhost using only the JDK.
 *
 * Run from this folder with Java 11+, optional port as the first argument:
 *     java Application.java 9000
 */
public class Application {

    private static final Map<String, String> MIME = Map.of(
            ".html", "text/html; charset=utf-8",
            ".js",   "text/javascript; charset=utf-8",
            ".css",  "text/css; charset=utf-8",
            ".png",  "image/png",
            ".json", "application/json",
            ".ico",  "image/x-icon"
    );

    public static void main(String[] args) throws IOException {
        int port = args.length > 0 ? Integer.parseInt(args[0]) : 8080;

        // Serve from the folder that actually holds the game files.
        Path root = resolveRoot();

        HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
        server.createContext("/", exchange -> handle(exchange, root));
        server.setExecutor(null);
        server.start();

        String url = "http://localhost:" + port + "/";
        System.out.println("Arrowvania serving from: " + root);
        System.out.println("Open " + url + "  (Ctrl+C to stop)");
        openBrowser(url);
    }

    private static Path resolveRoot() {
        // prefer the working directory over the compiled copy under out/
        Path cwd = Paths.get("").toAbsolutePath().normalize();
        if (Files.exists(cwd.resolve("index.html"))) {
            return cwd;
        }
        // fall back to the directory this class was loaded from
        try {
            Path here = Paths.get(Application.class.getProtectionDomain()
                    .getCodeSource().getLocation().toURI());
            Path dir = Files.isDirectory(here) ? here : here.getParent();
            if (dir != null && Files.exists(dir.resolve("index.html"))) {
                return dir.toAbsolutePath().normalize();
            }
        } catch (Exception ignored) {
            // fall through to working directory
        }
        return cwd;
    }

    private static void handle(HttpExchange exchange, Path root) throws IOException {
        try {
            boolean head = "HEAD".equalsIgnoreCase(exchange.getRequestMethod());
            String path = exchange.getRequestURI().getPath();
            if (path.equals("/") || path.isEmpty()) {
                path = "/index.html";
            }

            // block path traversal outside the root
            Path file = root.resolve(path.substring(1)).normalize();
            if (!file.startsWith(root) || !Files.exists(file) || Files.isDirectory(file)) {
                byte[] body = "404 Not Found".getBytes();
                exchange.sendResponseHeaders(404, head ? -1 : body.length);
                if (!head) try (OutputStream os = exchange.getResponseBody()) { os.write(body); }
                return;
            }

            byte[] bytes = Files.readAllBytes(file);
            exchange.getResponseHeaders().set("Content-Type", contentType(file));
            exchange.sendResponseHeaders(200, head ? -1 : bytes.length);
            if (!head) try (OutputStream os = exchange.getResponseBody()) { os.write(bytes); }
        } catch (IOException | RuntimeException e) {
            // a failed read must not kill the connection silently
            try {
                byte[] body = "500 Internal Server Error".getBytes();
                exchange.sendResponseHeaders(500, body.length);
                try (OutputStream os = exchange.getResponseBody()) { os.write(body); }
            } catch (IOException ignored) {
            }
        } finally {
            exchange.close();
        }
    }

    private static String contentType(Path file) {
        String name = file.getFileName().toString();
        int dot = name.lastIndexOf('.');
        String ext = dot < 0 ? "" : name.substring(dot).toLowerCase();
        return MIME.getOrDefault(ext, "application/octet-stream");
    }

    private static void openBrowser(String url) {
        try {
            if (Desktop.isDesktopSupported() && Desktop.getDesktop().isSupported(Desktop.Action.BROWSE)) {
                Desktop.getDesktop().browse(URI.create(url));
            }
        } catch (Exception ignored) {
        }
    }
}
