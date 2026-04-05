FROM ghcr.io/vndee/sandbox-python-311-bullseye

RUN python -m pip install --no-cache-dir \
    beautifulsoup4 \
    chardet \
    duckdb \
    lxml \
    matplotlib \
    networkx \
    numpy \
    odfpy \
    openpyxl \
    pandas \
    pdfplumber \
    plotly \
    polars \
    pyarrow \
    pypdf \
    pyxlsb \
    python-docx \
    python-pptx \
    scikit-learn \
    scipy \
    seaborn \
    statsmodels \
    sympy \
    tabulate \
    xlrd \
    xlsxwriter
